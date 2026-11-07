/**
 * @file chat/hooks/useAttachments.ts
 * @description 输入框附件状态：
 * - 草稿期纯本地零上传，选择器产物经入口映射与上限过滤进草稿
 * - 发送期先压缩再统一起传，任一失败整批返回 null 且失败项标 error
 * - 图片上传落定后顺手种入本地缓存，失败静默不影响发送
 * - 落定结果作为值交还调用方，发送流程不回读渲染快照
 * - 失败单项可重试，重试只补失败项
 */
import { useCallback, useState } from 'react';
import { FileInfo, FileType } from '../../types/Chat.ts';
import {
  compressImageIfNeeded,
  intakeFile,
  MAX_ATTACHMENTS,
  MAX_ATTACH_BYTES,
  type PickedFile,
} from '../util/FileUtils.ts';
import {
  MIME_BY_EXT,
  uploadAttachment,
  type UploadFilePart,
} from '../../api/server-api.ts';
import { getServerAddress } from '../../storage/StorageUtils.ts';
import { imageCache } from '../../storage/image-cache-rn.ts';
import { useChatStore } from '../../stores/chatStore.ts';
import { logger } from '../../lib/logger';

/**
 * 单项压缩后上传落定，返回成功与否的补丁。
 * 图片先过压缩判定，达标原样上传，超限压回后再传，格式与宽高与体积随产物修正。
 * 图片落定后把压缩件复制校验种入本地缓存，发过的图重启后不再回下载。
 */
async function settleUpload(
  item: FileInfo,
  address: string
): Promise<Partial<FileInfo> | null> {
  try {
    let part: UploadFilePart = {
      uri: item.url,
      name: item.fileName,
      type:
        item.type === FileType.image
          ? MIME_BY_EXT[item.format] ?? 'application/octet-stream'
          : 'application/octet-stream',
    };
    let width = item.width;
    let height = item.height;
    let format = item.format;
    if (item.type === FileType.image) {
      const compressed = await compressImageIfNeeded(item);
      part = {
        uri: compressed.uri,
        name: item.fileName,
        type: compressed.mimeType,
      };
      width = compressed.width;
      height = compressed.height;
      format = compressed.format;
    }
    const uploaded = await uploadAttachment(address, part);
    if (item.type === FileType.image) {
      const seeded = await imageCache.seed(uploaded.hash, part.uri, part.type);
      logger.info(
        `[attachments] seeded cache, name=${item.fileName} path=${
          seeded ?? 'none'
        }`
      );
    }
    return {
      status: 'uploaded',
      hash: uploaded.hash,
      fileSize: uploaded.size,
      format,
      width,
      height,
    };
  } catch (error) {
    logger.warn(
      `[attachments] upload failed, name=${item.fileName} error=${
        error instanceof Error ? error.message : error
      }`
    );
    return null;
  }
}

/** 附件草稿的状态机，ChatScreen 的状态区，addFiles 与 remove 与 retry 与 uploadAll 共用 */
export function useAttachments() {
  const [items, setItems] = useState<FileInfo[]>([]);

  /** 三条选择入口共用的添加函数，体积与数量当场过滤，能塞多少塞多少 */
  const addFiles = useCallback(
    (picked: PickedFile[]) => {
      if (picked.length === 0) return;
      const sized = picked.filter((p) => p.fileSize <= MAX_ATTACH_BYTES);
      if (sized.length < picked.length) {
        useChatStore.getState().showNotice('chat.fileOversize', {
          size: String(MAX_ATTACH_BYTES / 1024 / 1024),
        });
      }
      const room = Math.max(0, MAX_ATTACHMENTS - items.length);
      const taken = sized.slice(0, room);
      if (sized.length > room) {
        useChatStore.getState().showNotice('chat.attachmentLimit', {
          max: String(MAX_ATTACHMENTS),
        });
      }
      if (taken.length === 0) return;
      logger.info(
        `[attachments] intake accepted, picked=${picked.length} taken=${taken.length}`
      );
      setItems((prev) => [...prev, ...taken.map(intakeFile)]);
    },
    [items.length]
  );

  /** 从草稿删除单个附件 */
  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((f) => f.id !== id));
  }, []);

  /** 发送期先压缩再统一起传，返回落定后的附件数组，任一失败返回 null 且失败项标 error。
   *  落定结果作为值交还调用方，避免发送流程在上传后回头读渲染快照 */
  const uploadAll = useCallback(async (): Promise<FileInfo[] | null> => {
    const pending = items.filter(
      (f) => f.status === 'ready' || f.status === 'error'
    );
    if (pending.length === 0) return items;
    const address = getServerAddress();
    setItems((prev) =>
      prev.map((f) =>
        f.status === 'ready' || f.status === 'error'
          ? { ...f, status: 'uploading' }
          : f
      )
    );
    logger.info(
      `[attachments] upload batch start, count=${pending.length} address=${address}`
    );
    const patches = await Promise.all(
      pending.map((item) => settleUpload(item, address))
    );
    const patchById = new Map(
      pending.map((item, index) => [item.id, patches[index] ?? null] as const)
    );
    /** 把落定结果套到一份附件清单上，未参与上传的项原样保留，失败项标 error */
    const applyPatches = (list: FileInfo[]): FileInfo[] =>
      list.map((f) => {
        const patch = patchById.get(f.id);
        if (patch === undefined) return f;
        return patch ? { ...f, ...patch } : { ...f, status: 'error' };
      });
    setItems(applyPatches);
    const ok = patches.every(Boolean);
    logger.info(
      `[attachments] upload batch settled, ok=${
        patches.filter(Boolean).length
      } failed=${patches.filter((p) => !p).length}`
    );
    return ok ? applyPatches(items) : null;
  }, [items]);

  /** 发送期失败单项重试，仅 error 态可重试 */
  const retry = useCallback(
    (id: string) => {
      const target = items.find((f) => f.id === id);
      if (!target || target.status !== 'error') return;
      const address = getServerAddress();
      logger.info(`[attachments] retry upload, name=${target.fileName}`);
      setItems((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: 'uploading' } : f))
      );
      settleUpload(target, address).then((patch) => {
        setItems((prev) =>
          prev.map((f) =>
            f.id === id ? { ...f, ...(patch ?? { status: 'error' }) } : f
          )
        );
      });
    },
    [items]
  );

  /** 发送成功后清空草稿 */
  const clear = useCallback(() => setItems([]), []);

  const isUploading = items.some((f) => f.status === 'uploading');
  const hasError = items.some((f) => f.status === 'error');

  return {
    items,
    addFiles,
    remove,
    clear,
    uploadAll,
    retry,
    isUploading,
    hasError,
  };
}
