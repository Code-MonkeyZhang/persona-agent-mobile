/**
 * @file ModelPicker.tsx
 * @description 聊天页输入条上的模型入口。
 *   无壳裸标直放，模型标 24，点按弹出模型弹层。
 *   弹层自己不写任何记录，点选结果经 onPick 交给聊天页。
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ModelMark } from '../../component/BrandMark.tsx';
import { ModelSheet } from './ModelSheet.tsx';
import type { ModelConfig, ProviderStatus } from '../../api/server-api.ts';

interface ModelPickerProps {
  /** 全部供应商，弹层内部只留已配置密钥的那些 */
  providers: ProviderStatus[];
  /** 当前生效模型 */
  value: ModelConfig;
  /** Agent 默认模型，它的供应商在弹层里排第二段 */
  agentDefault: ModelConfig | null;
  /** 点选回调，要不要写会话模型与上次使用的供应商由聊天页决定 */
  onPick: (selection: ModelConfig) => void;
}

/** 模型入口，点按弹出模型弹层，弹层收起完成后卸载 */
export function ModelPicker({
  providers,
  value,
  agentDefault,
  onPick,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  /** 模型标查不到映射时退首字母，名字优先取供应商显示名，供应商不在清单里时退模型名 */
  const fallbackName =
    providers.find((p) => p.id === value.provider)?.name ?? value.model;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('agent.selectModel')}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
      >
        <ModelMark
          modelId={value.model}
          providerId={value.provider}
          name={fallbackName}
          size={24}
        />
      </Pressable>
      {open ? (
        <ModelSheet
          providers={providers}
          value={value}
          agentDefault={agentDefault}
          onPick={onPick}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  /** 触控区 32 见方，与旁边的加号按钮同尺寸，模型标 24 居中 */
  hit: {
    padding: 4,
  },
  pressed: {
    opacity: 0.6,
    transform: [{ scale: 0.9 }],
  },
});
