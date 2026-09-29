/**
 * @file AgentDetailScreen.tsx
 * @description Agent 详情页。
 *   名字简介与数字配置与系统提示词只读展示，模型与音色与语音语言走底部选择器可改，
 *   写回走 updateAgent 改一项存一项，失败回滚，音色段带真试听。
 *   长相基准是 demo 的 AgentDetailPage，页面壳由原生 Stack header 承担。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import ImageViewing from 'react-native-image-viewing';
import { ChevronRight, Folder, Volume2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { logger } from '../lib/logger';
import type { RouteParamList } from '../types/RouteTypes.ts';
import {
  type AgentInfo,
  type AgentUpdateInput,
  type ProviderStatus,
  type VoiceOption,
  fetchAgentDetail,
  fetchTtsConfig,
  getAgentAvatarUrl,
  listProviders,
  listVoices,
  updateAgent,
} from '../api/server-api.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import AgentAvatar from '../chat/component/AgentAvatar.tsx';
import {
  GroupCard,
  GroupSection,
  monoFont,
} from '../agent-nav/component/NavDetailShared.tsx';
import { synthesize } from '../lib/tts.ts';
import { getAudioPlayer } from '../lib/audio-player.ts';
import { writeAudioFile } from '../stores/voiceStore.ts';
import {
  ActionSheet,
  SheetGroupLabel,
  SheetOption,
} from './component/ActionSheet.tsx';

type Props = NativeStackScreenProps<RouteParamList, 'AgentDetail'>;

/** 语音语言的可选值到文案键的映射，default 表示跟随全局 */
const LANG_OPTIONS = [
  { value: 'default', key: 'agent.langDefault' },
  { value: 'zh', key: 'agent.langZh' },
  { value: 'en', key: 'agent.langEn' },
  { value: 'ja', key: 'agent.langJa' },
] as const;

/** voiceLanguage 到 MiniMax language_boost 的映射，缺省语言不传增强 */
const LANG_BOOST: Record<string, string> = {
  zh: 'Chinese',
  en: 'English',
  ja: 'Japanese',
};

/** 选择器开合态，同屏最多一个，值区分模型、音色与语言 */
type SheetKind = 'model' | 'voice' | 'lang' | null;

/**
 * Agent 详情页。进页并行拉本体与两个选择器数据源，
 * 选择器改项即时乐观写回，其余字段只读展示。
 */
const AgentDetailScreen: React.FC<Props> = ({ route }) => {
  const { agentId } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const address = getServerAddress();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const ttsApiKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!address) {
        return;
      }
      try {
        // 本体失败整页落空，两个选择器数据源各自兜底空数组保页面可用
        const [agentData, providerList, voiceList] = await Promise.all([
          fetchAgentDetail(address, agentId),
          listProviders(address).catch((e: unknown) => {
            logger.error(`[AgentDetail] listProviders failed: ${e}`);
            return [] as ProviderStatus[];
          }),
          listVoices(address).catch((e: unknown) => {
            logger.error(`[AgentDetail] listVoices failed: ${e}`);
            return [] as VoiceOption[];
          }),
        ]);
        setAgent(agentData);
        setProviders(providerList);
        setVoices(voiceList);
        logger.info(
          `[AgentDetail] loaded, providers=${providerList.length} voices=${voiceList.length}`
        );
      } catch (e) {
        logger.error(`[AgentDetail] load failed: ${e}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [address, agentId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!agent) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t('agent.notFound')}</Text>
      </View>
    );
  }

  const currentVoice = voices.find((v) => v.id === agent.voiceId);
  const currentLang = agent.voiceLanguage ?? 'default';
  const currentLangLabel = t(
    LANG_OPTIONS.find((l) => l.value === currentLang)?.key ??
      'agent.langDefault'
  );

  /** 音色选择器的分组，克隆组在前，预置按男女分组，空组不渲染 */
  const voiceGroups = [
    {
      label: t('agent.cloned'),
      items: voices.filter((v) => v.group === 'cloned'),
    },
    {
      label: t('agent.female'),
      items: voices.filter(
        (v) => v.group === 'preset' && v.gender === 'female'
      ),
    },
    {
      label: t('agent.male'),
      items: voices.filter((v) => v.group === 'preset' && v.gender === 'male'),
    },
  ].filter((g) => g.items.length > 0);

  /** 乐观写回单项配置，失败还原并弹窗提示 */
  const patch = async (input: AgentUpdateInput) => {
    const prev = agent;
    setAgent({ ...agent, ...input });
    try {
      await updateAgent(address, agentId, input);
    } catch (e) {
      logger.error(`[AgentDetail] updateAgent failed: ${e}`);
      setAgent(prev);
      Alert.alert(t('agent.updateFailedTitle'), t('agent.updateFailedMsg'));
    }
  };

  const togglePrompt = () => {
    setPromptExpanded((v) => !v);
  };

  /** 真试听：apiKey 惰性拉取缓存，合成走端上直连，落盘后交给播放器 */
  const handlePreviewVoice = async () => {
    if (previewingVoice || !agent.voiceId) {
      return;
    }
    setPreviewingVoice(true);
    try {
      if (ttsApiKeyRef.current === null) {
        const config = await fetchTtsConfig(address);
        ttsApiKeyRef.current = config.apiKey;
      }
      if (!ttsApiKeyRef.current) {
        Alert.alert(t('agent.voicePreviewFailed'));
        return;
      }
      logger.info(
        `[AgentDetail] voice preview start, voiceId=${agent.voiceId}`
      );
      const audio = await synthesize(
        t('agent.voicePreviewText'),
        agent.voiceId,
        ttsApiKeyRef.current,
        undefined,
        LANG_BOOST[agent.voiceLanguage ?? '']
      );
      const filePath = await writeAudioFile(audio);
      await getAudioPlayer().play(filePath);
    } catch (e) {
      logger.error(`[AgentDetail] voice preview failed: ${e}`);
      Alert.alert(t('agent.voicePreviewFailed'));
    } finally {
      setPreviewingVoice(false);
    }
  };

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
    >
      {/* 头部卡：圆头像在左，名称与简介在右静态展示，头像点图预览 */}
      <View style={styles.headerCard}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setPreviewUrl(getAgentAvatarUrl(agentId, address))}
        >
          <AgentAvatar
            agentId={agentId}
            serverAddress={address}
            size={64}
            fallbackIconSize={30}
            fallbackBackgroundColor={colors.surfaceSecondary}
          />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.name}>{agent.name}</Text>
          {agent.description ? (
            <Text style={styles.desc} numberOfLines={2}>
              {agent.description}
            </Text>
          ) : null}
        </View>
      </View>

      {/* 模型配置段：模型行走选择器，步数与提示词只读 */}
      <GroupSection title={t('agent.sectionModel')}>
        <GroupCard>
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => setSheet('model')}
          >
            <Text style={styles.rowLabel}>{t('agent.defaultModel')}</Text>
            <Text style={styles.rowValueMono} numberOfLines={1}>
              {agent.defaultModel.model}
            </Text>
            <ChevronRight size={14} color={colors.textTertiary} />
          </TouchableOpacity>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>{t('agent.maxSteps')}</Text>
            <Text style={styles.rowValue}>{agent.maxSteps}</Text>
          </View>
          <TouchableOpacity
            style={[styles.row, styles.rowBorder]}
            activeOpacity={0.7}
            onPress={togglePrompt}
          >
            <Text style={styles.rowLabel}>{t('agent.systemPrompt')}</Text>
            <ChevronRight
              size={14}
              color={colors.textTertiary}
              style={promptExpanded ? styles.chevronExpanded : undefined}
            />
          </TouchableOpacity>
          {promptExpanded ? (
            <View style={styles.promptBox}>
              <Text style={styles.promptText}>{agent.systemPrompt}</Text>
            </View>
          ) : null}
        </GroupCard>
      </GroupSection>

      {/* 聊天配置段：两个数字只读 */}
      <GroupSection title={t('agent.sectionChat')}>
        <GroupCard>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>
              {t('agent.compressionThreshold')}
            </Text>
            <Text style={styles.rowValue}>{agent.compressionThreshold}%</Text>
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>{t('agent.memoryInterval')}</Text>
            <Text style={styles.rowValue}>
              {agent.dreamIntervalMinutes}
              {t('agent.minutesUnit')}
            </Text>
          </View>
        </GroupCard>
      </GroupSection>

      {/* 音色段：试听按钮随音色行，音色与语言都走底部选择器 */}
      <GroupSection title={t('agent.sectionVoice')}>
        <GroupCard>
          <View style={styles.row}>
            <TouchableOpacity
              style={styles.previewBtn}
              activeOpacity={0.7}
              disabled={!currentVoice || previewingVoice}
              onPress={handlePreviewVoice}
            >
              {previewingVoice ? (
                <ActivityIndicator size="small" color={colors.textTertiary} />
              ) : (
                <Volume2 size={14} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.voiceRow}
              activeOpacity={0.7}
              onPress={() => setSheet('voice')}
            >
              <Text style={styles.rowLabel} numberOfLines={1}>
                {currentVoice ? currentVoice.name : t('agent.voiceNone')}
              </Text>
              <ChevronRight size={14} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.row, styles.rowBorder]}
            activeOpacity={0.7}
            onPress={() => setSheet('lang')}
          >
            <Text style={styles.rowLabel}>{t('agent.voiceLanguage')}</Text>
            <Text style={styles.rowValue}>{currentLangLabel}</Text>
            <ChevronRight size={14} color={colors.textTertiary} />
          </TouchableOpacity>
        </GroupCard>
      </GroupSection>

      {/* 工作空间段：路径纯展示 */}
      <GroupSection title={t('agent.sectionWorkspace')}>
        <GroupCard>
          <View style={styles.iconRow}>
            <Folder size={15} color={colors.textTertiary} />
            <Text style={styles.pathText}>
              {agent.defaultWorkspacePath || '-'}
            </Text>
          </View>
        </GroupCard>
      </GroupSection>

      {/* 模型选择器：按供应商分组，选中按供应商加模型双匹配 */}
      {sheet === 'model' ? (
        <ActionSheet
          title={t('agent.selectModel')}
          onClose={() => setSheet(null)}
        >
          {providers.map((provider) => (
            <View key={provider.id}>
              <SheetGroupLabel>{provider.id}</SheetGroupLabel>
              {provider.models.map((model) => (
                <SheetOption
                  key={model}
                  label={model}
                  selected={
                    agent.defaultModel.provider === provider.id &&
                    agent.defaultModel.model === model
                  }
                  onPress={() => {
                    patch({ defaultModel: { provider: provider.id, model } });
                    setSheet(null);
                  }}
                />
              ))}
            </View>
          ))}
        </ActionSheet>
      ) : null}

      {/* 音色选择器：克隆组在前，预置按男女分组 */}
      {sheet === 'voice' ? (
        <ActionSheet
          title={t('agent.selectVoice')}
          onClose={() => setSheet(null)}
        >
          {voiceGroups.map((group) => (
            <View key={group.label}>
              <SheetGroupLabel>{group.label}</SheetGroupLabel>
              {group.items.map((voice) => (
                <SheetOption
                  key={voice.id}
                  label={voice.name}
                  selected={agent.voiceId === voice.id}
                  onPress={() => {
                    patch({ voiceId: voice.id });
                    setSheet(null);
                  }}
                />
              ))}
            </View>
          ))}
        </ActionSheet>
      ) : null}

      {/* 语言选择器：四项单选，default 写回时清空字段 */}
      {sheet === 'lang' ? (
        <ActionSheet
          title={t('agent.voiceLanguage')}
          onClose={() => setSheet(null)}
        >
          {LANG_OPTIONS.map((opt) => (
            <SheetOption
              key={opt.value}
              label={t(opt.key)}
              selected={currentLang === opt.value}
              onPress={() => {
                patch({
                  voiceLanguage:
                    opt.value === 'default' ? undefined : opt.value,
                });
                setSheet(null);
              }}
            />
          ))}
        </ActionSheet>
      ) : null}

      <ImageViewing
        images={previewUrl ? [{ uri: previewUrl }] : []}
        imageIndex={0}
        visible={previewUrl !== null}
        onRequestClose={() => setPreviewUrl(null)}
      />
    </ScrollView>
  );
};

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    scrollView: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    content: {
      padding: 16,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    headerCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.borderLight,
      marginBottom: 16,
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    name: {
      fontSize: 20,
      fontWeight: '600',
      color: colors.text,
    },
    desc: {
      marginTop: 4,
      fontSize: 12,
      lineHeight: 18,
      color: colors.textTertiary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    rowLabel: {
      flex: 1,
      fontSize: 14,
      color: colors.text,
    },
    rowValue: {
      fontSize: 14,
      color: colors.textTertiary,
    },
    rowValueMono: {
      maxWidth: 170,
      fontSize: 12,
      fontFamily: monoFont,
      color: colors.textTertiary,
    },
    chevronExpanded: {
      transform: [{ rotate: '90deg' }],
    },
    promptBox: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    promptText: {
      minHeight: 120,
      borderRadius: 10,
      backgroundColor: colors.surfaceSecondary,
      padding: 10,
      fontSize: 12,
      lineHeight: 18,
      color: colors.text,
    },
    previewBtn: {
      width: 28,
      height: 28,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.borderLight,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    voiceRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    iconRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    pathText: {
      flex: 1,
      fontSize: 11,
      lineHeight: 18,
      fontFamily: monoFont,
      color: colors.textTertiary,
    },
  });

export default AgentDetailScreen;
