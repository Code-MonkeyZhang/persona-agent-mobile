/**
 * @file ModelSheet.tsx
 * @description 模型弹层，聊天页与 Agent 详情页共用。
 *   八成屏高无标题，把手下方是供应商胶囊行，只列已配置供应商，列表只列选中那一家。
 *   供应商排位见 providerOrder，容量归档见 contextTiers，弹层自己不写任何记录。
 *   点选经 onPick 交给调用方后带动画收起，收起完成由 onClose 卸载。
 */
import React, {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, ScanEye } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import {
  ActionSheet,
  type ActionSheetHandle,
} from '../../agent-detail/component/ActionSheet.tsx';
import { ModelMark, ProviderMark } from '../../component/BrandMark.tsx';
import { tierOf } from '../util/contextTiers.ts';
import { orderForSelector } from '../util/providerOrder.ts';
import { getLastUsedProvider } from '../../storage/StorageUtils.ts';
import {
  ColorScheme,
  monoFont,
  typography,
  useTheme,
} from '../../theme/index.ts';
import { logger } from '../../lib/logger';
import type { ModelConfig, ProviderStatus } from '../../api/server-api.ts';

/** 弹层高度占屏比，八成屏高 */
const MODEL_SHEET_SNAP_POINT = '80%';

interface ModelSheetProps {
  /** 全部供应商，弹层内部只留已配置密钥的那些 */
  providers: ProviderStatus[];
  /** 当前生效的模型，它的供应商排最前，它所在的行亮选中态 */
  value: ModelConfig;
  /** Agent 默认模型，它的供应商排第二，Agent 详情页不传，那里的当前值就是 Agent 默认 */
  agentDefault?: ModelConfig | null;
  /** 点选回调，一次回传供应商与模型 */
  onPick: (selection: ModelConfig) => void;
  /** 面板收起完成后回调，调用方据此卸载弹层 */
  onClose: () => void;
}

/**
 * 模型弹层的一行，模型标贴左缘整行垂直居中，名字在上，容量徽章与看图图标在第二行。
 * cur 标当前模型并在右缘亮出圆底对钩，其余行在同一位置留同宽空位。
 */
function ModelRow({
  provider,
  modelId,
  cur,
  first,
  onPress,
}: {
  provider: ProviderStatus;
  modelId: string;
  cur: boolean;
  /** 是否清单首行，首行不画上缘发丝线 */
  first: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const contextWindow = provider.contextWindows?.[modelId];
  const hasVision = provider.visionModelIds?.includes(modelId) ?? false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={modelId}
      accessibilityState={{ selected: cur }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowBorder,
        cur && styles.rowCur,
        !cur && pressed && styles.rowPressed,
      ]}
    >
      <ModelMark
        modelId={modelId}
        providerId={provider.id}
        name={provider.name}
        size={24}
      />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {modelId}
        </Text>
        <View style={styles.rowMeta}>
          {contextWindow !== undefined && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{tierOf(contextWindow)}</Text>
            </View>
          )}
          {hasVision && (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('agent.modelVision')}
            >
              <ScanEye size={14} color={colors.textSecondary} />
            </View>
          )}
        </View>
      </View>
      <View style={[styles.checkSlot, cur && styles.checkSlotCur]}>
        {cur ? (
          <Check size={13} color={colors.primary} strokeWidth={3} />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * 模型弹层。打开时选中的胶囊随当前模型落位，当前那家不在清单里时落首家。
 * 切换胶囊后清单随之切换并回到顶部。
 */
export const ModelSheet = React.forwardRef<ActionSheetHandle, ModelSheetProps>(
  function ModelSheetBase(
    { providers, value, agentDefault, onPick, onClose },
    ref
  ) {
    const { t } = useTranslation();
    const { colors } = useTheme();
    const styles = useMemo(() => createStyles(colors), [colors]);
    const sheetRef = useRef<ActionSheetHandle>(null);
    const lastUsedProviderId = getLastUsedProvider() || undefined;

    useImperativeHandle(ref, () => ({
      dismiss: () => sheetRef.current?.dismiss(),
    }));

    /** 供应商胶囊行，只留配了密钥的，顺序按排序规则现算 */
    const providerIds = useMemo(
      () =>
        orderForSelector(
          providers.filter((p) => p.hasAuth),
          value.provider,
          agentDefault?.provider,
          lastUsedProviderId
        ).map((p) => p.id),
      [providers, value.provider, agentDefault?.provider, lastUsedProviderId]
    );

    const [cap, setCap] = useState(() =>
      providerIds.includes(value.provider)
        ? value.provider
        : providerIds[0] ?? ''
    );

    const capProvider = providers.find((p) => p.id === cap);

    /** 每次排位留一条日志，三个位次的输入一并记下，排位不对时可据此排查 */
    useEffect(() => {
      logger.info(
        `[ModelSheet] provider order=${providerIds.join(',')} current=${
          value.provider
        } agentDefault=${agentDefault?.provider ?? 'none'} lastUsed=${
          lastUsedProviderId ?? 'none'
        }`
      );
    }, [
      providerIds,
      value.provider,
      agentDefault?.provider,
      lastUsedProviderId,
    ]);

    /** 点选即回传并带动画收起，记录由调用方写 */
    const handlePick = (modelId: string) => {
      logger.info(`[ModelSheet] select provider=${cap} model=${modelId}`);
      onPick({ provider: cap, model: modelId });
      sheetRef.current?.dismiss();
    };

    return (
      <ActionSheet
        ref={sheetRef}
        snapPoint={MODEL_SHEET_SNAP_POINT}
        onClose={onClose}
        contentKey={cap}
        header={
          providerIds.length > 0 ? (
            <View style={styles.capsuleBar}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.capsuleRow}
              >
                {providerIds.map((id) => {
                  const on = cap === id;
                  const name = providers.find((p) => p.id === id)?.name ?? id;
                  return (
                    <Pressable
                      key={id}
                      accessibilityRole="button"
                      accessibilityLabel={name}
                      accessibilityState={{ selected: on }}
                      onPress={() => setCap(id)}
                      style={({ pressed }) => [
                        styles.capsule,
                        on && styles.capsuleOn,
                        !on && pressed && styles.capsulePressed,
                      ]}
                    >
                      <ProviderMark providerId={id} name={name} size={16} />
                      <Text
                        style={[styles.capsuleText, on && styles.capsuleTextOn]}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : undefined
        }
      >
        {!capProvider || capProvider.models.length === 0 ? (
          <Text style={styles.emptyHint}>{t('agent.noConfiguredModel')}</Text>
        ) : (
          capProvider.models.map((modelId, index) => (
            <ModelRow
              key={modelId}
              provider={capProvider}
              modelId={modelId}
              cur={value.provider === cap && value.model === modelId}
              first={index === 0}
              onPress={() => handlePick(modelId)}
            />
          ))
        )}
      </ActionSheet>
    );
  }
);

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    /** 胶囊行容器，与清单共用 16 的左右留白，下缘一条细分隔线 */
    capsuleBar: {
      paddingTop: 2,
      paddingHorizontal: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderLight,
    },
    capsuleRow: {
      gap: 8,
    },
    /** 供应商胶囊，高 32 取全圆，未选中白底灰描边 */
    capsule: {
      height: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
    },
    capsuleOn: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    capsulePressed: {
      backgroundColor: colors.surface,
    },
    capsuleText: {
      ...typography.caption,
      color: colors.textDarkGray,
    },
    capsuleTextOn: {
      color: colors.primaryForeground,
    },
    emptyHint: {
      ...typography.content,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingVertical: 24,
    },
    /** 模型行，高 61，模型标贴左缘，名字与第二行信息成列，右缘留对钩位 */
    row: {
      height: 61,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 2,
    },
    rowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.borderLight,
    },
    rowCur: {
      borderRadius: 12,
      backgroundColor: colors.primaryFaintBackground,
    },
    rowPressed: {
      opacity: 0.7,
    },
    rowText: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    rowName: {
      ...typography.content,
      fontFamily: monoFont,
      color: colors.textDarkGray,
    },
    rowMeta: {
      height: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    /** 容量徽章，白底灰描边的全圆小胶囊，容量是中性信息不用语义色 */
    badge: {
      height: 18,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.badgeBorder,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 7,
    },
    badgeText: {
      ...typography.micro,
      fontWeight: '500',
      color: colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    checkSlot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkSlotCur: {
      backgroundColor: colors.primarySelectedBackground,
    },
  });
