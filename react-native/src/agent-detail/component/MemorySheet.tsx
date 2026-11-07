/**
 * @file MemorySheet.tsx
 * @description 记忆条目的底部编辑表单，新增与编辑共用。
 *   基于 @gorhom/bottom-sheet 的 BottomSheetModal，挂载即弹出，长相与交互照 demo 蓝本：
 *   字段序为标题、内容、类型分段、触发词，类型在触发词上方，选常驻则触发词输入随之隐藏。
 *   启用开关在表单头右上角与标题同行：编辑态拨动即时落库失败回滚，新增态只改本地草稿随保存提交。
 *   删除带两步确认，保存成功由调用方收起表单。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme, typography } from '../../theme/index.ts';
import { logger } from '../../lib/logger';
import type { MemoryEntry, MemoryType } from '../../api/server-api.ts';

/** 表单草稿的五个可编辑字段 */
export interface MemorySheetDraft {
  title: string;
  content: string;
  keys: string[];
  type: MemoryType;
  enabled: boolean;
}

interface MemorySheetProps {
  /** 编辑目标，null 表示新增草稿 */
  entry: MemoryEntry | null;
  onClose: () => void;
  /** 保存通道，编辑与新增共用，落库成败由调用方以 Promise 决定是否收起 */
  onSubmit: (draft: MemorySheetDraft) => Promise<void>;
  /** 删除通道，仅编辑态提供 */
  onDelete?: () => void;
  /** 启停即时落库通道，仅编辑态提供，新增态开关只改草稿 */
  onToggleEnabled?: (enabled: boolean) => Promise<void>;
}

/** 调用方收起弹层的句柄 */
export type MemorySheetHandle = Pick<
  React.ComponentRef<typeof BottomSheetModal>,
  'dismiss'
>;

/** 表单高度占屏比，照 demo 蓝本的上限档 */
const SNAP_POINT = '84%';

/** 把条目或空草稿初始化为表单态 */
function toDraft(entry: MemoryEntry | null): MemorySheetDraft {
  return {
    title: entry?.title ?? '',
    content: entry?.content ?? '',
    keys: entry?.keys ?? [],
    type: entry?.type ?? 'triggered',
    enabled: entry?.enabled ?? true,
  };
}

/** 把逗号分隔的触发词文本解析为去重数组，中英文逗号都认 */
function parseKeys(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[,，]/)
        .map((k) => k.trim())
        .filter(Boolean)
    )
  );
}

/** 底部编辑表单：挂载自动弹出，Android 返回键收起面板 */
export const MemorySheet = React.forwardRef<
  MemorySheetHandle,
  MemorySheetProps
>(function MemorySheetBase(
  { entry, onClose, onSubmit, onDelete, onToggleEnabled },
  ref
) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const sheetRef = useRef<React.ComponentRef<typeof BottomSheetModal>>(null);
  const [draft, setDraft] = useState<MemorySheetDraft>(() => toDraft(entry));
  const [keysText, setKeysText] = useState(entry?.keys.join(', ') ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const isNew = entry === null;

  useEffect(() => {
    sheetRef.current?.present();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sheetRef.current?.dismiss();
      return true;
    });
    return () => sub.remove();
  }, []);

  React.useImperativeHandle(ref, () => ({
    dismiss: () => sheetRef.current?.dismiss(),
  }));

  const canSave = !saving && draft.content.trim().length > 0;

  /** 启停拨动：编辑态乐观更新后即时落库，失败回滚；新增态只改草稿 */
  const handleToggle = async (value: boolean) => {
    const prev = draft.enabled;
    setDraft((d) => ({ ...d, enabled: value }));
    if (isNew || !onToggleEnabled) return;
    try {
      await onToggleEnabled(value);
    } catch (e) {
      logger.error(`[MemorySheet] toggle enabled failed: ${e}`);
      setDraft((d) => ({ ...d, enabled: prev }));
    }
  };

  const handleSubmit = async () => {
    if (!canSave) return;
    const content = draft.content.trim();
    // 标题留空时截取内容开头，与工具侧口径一致
    const title = draft.title.trim() || content.slice(0, 12);
    setSaving(true);
    try {
      await onSubmit({
        title,
        content,
        keys: parseKeys(keysText),
        type: draft.type,
        enabled: draft.enabled,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!onDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete();
  };

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={[SNAP_POINT]}
      enableDynamicSizing={false}
      onDismiss={onClose}
      backdropComponent={SheetBackdrop}
      backgroundStyle={styles.panel}
      handleIndicatorStyle={styles.dragBar}
      keyboardBehavior="interactive"
    >
      {/* 表单头：标题与启用开关同行 */}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>
          {isNew ? t('memory.addTitle') : t('memory.editTitle')}
        </Text>
        <Switch
          value={draft.enabled}
          onValueChange={handleToggle}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.card}
        />
      </View>

      <BottomSheetScrollView contentContainerStyle={styles.scrollContent}>
        {/* 标题 */}
        <Text style={styles.label}>{t('memory.titleLabel')}</Text>
        <TextInput
          style={styles.input}
          value={draft.title}
          onChangeText={(v) => setDraft((d) => ({ ...d, title: v }))}
          placeholder={t('memory.titlePlaceholder')}
          placeholderTextColor={colors.placeholder}
        />

        {/* 内容 */}
        <Text style={styles.label}>{t('memory.contentLabel')}</Text>
        <TextInput
          style={[styles.input, styles.contentInput]}
          value={draft.content}
          onChangeText={(v) => setDraft((d) => ({ ...d, content: v }))}
          placeholder={t('memory.contentPlaceholder')}
          placeholderTextColor={colors.placeholder}
          multiline
        />

        {/* 类型分段：先定注入方式，常驻条目触发词输入随之隐藏 */}
        <Text style={styles.label}>{t('memory.typeLabel')}</Text>
        <View style={styles.segment}>
          {(
            [
              { value: 'pinned', label: t('memory.typePinned') },
              { value: 'triggered', label: t('memory.typeTriggered') },
            ] as const
          ).map(({ value, label }) => (
            <TouchableOpacity
              key={value}
              style={[
                styles.segmentItem,
                draft.type === value ? styles.segmentItemActive : undefined,
              ]}
              activeOpacity={0.7}
              onPress={() => setDraft((d) => ({ ...d, type: value }))}
            >
              <Text
                style={
                  draft.type === value
                    ? styles.segmentTextActive
                    : styles.segmentText
                }
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 触发词只对触发类型有意义，常驻条目每轮注入不经过匹配 */}
        {draft.type === 'triggered' ? (
          <>
            <Text style={styles.label}>{t('memory.keysLabel')}</Text>
            <TextInput
              style={styles.input}
              value={keysText}
              onChangeText={setKeysText}
              placeholder={t('memory.keysPlaceholder')}
              placeholderTextColor={colors.placeholder}
            />
          </>
        ) : null}
      </BottomSheetScrollView>

      {/* 底部动作行：删除两步确认，取消与保存 */}
      <View style={styles.actionRow}>
        {onDelete ? (
          <TouchableOpacity activeOpacity={0.6} onPress={handleDelete}>
            <Text style={confirmDelete ? styles.deleteConfirm : styles.delete}>
              {confirmDelete ? t('memory.deleteConfirm') : t('memory.delete')}
            </Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
        <View style={styles.actionRight}>
          <TouchableOpacity activeOpacity={0.6} onPress={onClose}>
            <Text style={styles.cancelText}>{t('memory.cancel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.8}
            disabled={!canSave}
            onPress={handleSubmit}
            style={[
              styles.saveBtn,
              !canSave ? styles.saveBtnDisabled : undefined,
            ]}
          >
            <Text style={styles.saveText}>{t('memory.save')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheetModal>
  );
});

/** 遮罩随面板位置淡入淡出，点按收起整个弹层 */
const SheetBackdrop = (
  props: React.ComponentProps<typeof BottomSheetBackdrop>
) => (
  <BottomSheetBackdrop
    {...props}
    appearsOnIndex={0}
    disappearsOnIndex={-1}
    pressBehavior="close"
  />
);

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    panel: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
    },
    dragBar: {
      backgroundColor: colors.borderLight,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 8,
    },
    headerTitle: {
      ...typography.body,
      fontWeight: '600',
      color: colors.text,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    label: {
      ...typography.meta,
      color: colors.textTertiary,
      marginBottom: 6,
      marginTop: 10,
    },
    input: {
      ...typography.content,
      color: colors.text,
      backgroundColor: colors.inputBackground,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    contentInput: {
      minHeight: 92,
      textAlignVertical: 'top',
    },
    segment: {
      flexDirection: 'row',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 10,
      padding: 3,
    },
    segmentItem: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
      borderRadius: 8,
    },
    segmentItemActive: {
      backgroundColor: colors.primary,
    },
    segmentText: {
      ...typography.content,
      color: colors.textSecondary,
    },
    segmentTextActive: {
      ...typography.content,
      color: colors.primaryForeground,
      fontWeight: '600',
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 24,
    },
    delete: {
      ...typography.content,
      color: colors.textTertiary,
    },
    deleteConfirm: {
      ...typography.content,
      color: colors.error,
      fontWeight: '600',
    },
    actionRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    cancelText: {
      ...typography.content,
      color: colors.textSecondary,
    },
    saveBtn: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    saveBtnDisabled: {
      opacity: 0.4,
    },
    saveText: {
      ...typography.content,
      color: colors.primaryForeground,
      fontWeight: '600',
    },
  });
