/**
 * @file CustomMessageComponent.tsx
 * @description 聊天消息渲染组件 - 负责渲染每条消息的 UI（头部、思考过程、正文、性能指标行、附件）
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from 'react-native';
import Share from 'react-native-share';
import { MessageProps } from 'react-native-gifted-chat';
import { CustomMarkdownRenderer } from './markdown/CustomMarkdownRenderer.tsx';
import { MarkedStyles } from 'react-native-marked/src/theme/types.ts';
import { ChatStatus, PressMode, ChatMessage } from '../../types/Chat.ts';
import { trigger } from '../util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import {
  CustomFileListComponent,
  DisplayMode,
} from './CustomFileListComponent.tsx';
import FileViewer from 'react-native-file-viewer';
import { logger } from '../../lib/logger';
import { CustomTokenizer } from './markdown/CustomTokenizer.ts';
import Markdown from './markdown/Markdown.tsx';
import { State, TapGestureHandler } from 'react-native-gesture-handler';
import { useTheme, ColorScheme, typography } from '../../theme/index.ts';
import i18n from '../../i18n/index.ts';
import CollapsedThoughtProcess from './CollapsedThoughtProcess.tsx';
import AgentAvatar from './AgentAvatar.tsx';
import { useSettingsStore } from '../../stores/settingsStore.ts';

/** 组件 Props 类型定义，继承自 GiftedChat 的 MessageProps，扩展了聊天状态等属性 */
interface CustomMessageProps extends MessageProps<ChatMessage> {
  chatStatus: ChatStatus;
  isLastAIMessage?: boolean;
  onReasoningToggle?: (
    expanded: boolean,
    height: number,
    animated: boolean
  ) => void;
  agentId: string;
  /** 实时角色名，来自 chatStore.agentName，改名或切换 agent 后即时跟随 */
  agentName: string;
  serverAddress: string;
}

const { width: screenWidth } = Dimensions.get('window');

/** 自定义消息渲染组件：根据消息类型（用户/AI）渲染不同的 UI 层（头部、思考过程、正文、操作按钮、附件） */
const CustomMessageComponent: React.FC<CustomMessageProps> = ({
  currentMessage,
  chatStatus,
  isLastAIMessage,
  onReasoningToggle,
  agentId,
  agentName,
  serverAddress,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const thoughtProcessVisible = useSettingsStore(
    (s) => s.thoughtProcessVisible
  );
  const chatStatusRef = useRef(chatStatus);
  const [forceShowButtons, setForceShowButtons] = useState(false);
  const isUser = useRef(currentMessage?.user?._id === 1);

  const toggleButtons = useCallback(() => {
    setForceShowButtons((prev) => !prev);
  }, []);

  const handleImagePress = useCallback((pressMode: PressMode, url: string) => {
    if (pressMode === PressMode.Click) {
      FileViewer.open(url)
        .then(() => {})
        .catch((error) => {
          logger.warn('[Message] image open failed:', error);
        });
    } else if (pressMode === PressMode.LongPress) {
      trigger(HapticFeedbackTypes.notificationSuccess);
      const shareOptions = {
        url: url,
        type: 'image/png',
        title: i18n.t('chat.shareImageTitle'),
      };
      Share.open(shareOptions)
        .then((res) => logger.debug('[Message] share result:', res))
        .catch((err) => err && logger.warn('[Message] share failed:', err));
    }
  }, []);

  const customMarkdownRenderer = useMemo(
    () =>
      new CustomMarkdownRenderer(
        handleImagePress,
        colors,
        [],
        onReasoningToggle
      ),
    [handleImagePress, colors, onReasoningToggle]
  );

  const customTokenizer = useMemo(() => new CustomTokenizer(), []);

  const handleShowButton = useCallback(() => {
    toggleButtons();
  }, [toggleButtons]);

  const messageContent = useMemo(() => {
    if (!currentMessage) {
      return null;
    }

    if (!isUser.current) {
      // 流式起始正文为空时不渲染气泡，避免出现空灰块
      if (currentMessage.text.trim().length === 0) {
        return null;
      }
      return (
        <View style={styles.answerContainer}>
          <Markdown
            value={currentMessage.text}
            styles={customMarkedStyles}
            renderer={customMarkdownRenderer}
            tokenizer={customTokenizer}
            chatStatus={chatStatusRef.current}
          />
        </View>
      );
    }

    return (
      <View
        style={[
          styles.questionContainer,
          currentMessage.queued && styles.questionContainerQueued,
          { maxWidth: (screenWidth * 3) / 4 },
        ]}
      >
        <Text
          style={[
            styles.questionText,
            currentMessage.queued && styles.questionTextQueued,
          ]}
          selectable
        >
          {currentMessage.text}
        </Text>
      </View>
    );
  }, [
    currentMessage,
    customMarkdownRenderer,
    customTokenizer,
    styles.questionContainer,
    styles.answerContainer,
    styles.questionContainerQueued,
    styles.questionText,
    styles.questionTextQueued,
  ]);

  /** 回合结束后的性能指标行，宿主按显隐门槛条件渲染 */
  const messageActionButtons = useMemo(() => {
    if (!currentMessage?.metrics) {
      return null;
    }
    const metrics = currentMessage.metrics;
    return (
      <View style={styles.actionButtonsContainer}>
        <Text style={styles.metricsText}>
          {`latency ${metrics.latencyMs}s | ${metrics.speed} tok/s`}
        </Text>
      </View>
    );
  }, [
    currentMessage?.metrics,
    styles.actionButtonsContainer,
    styles.metricsText,
  ]);

  if (!currentMessage) {
    return null;
  }
  const hasSteps = (currentMessage?.steps?.length ?? 0) > 0;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {!isUser.current && (
          <>
            <AgentAvatar
              agentId={agentId}
              serverAddress={serverAddress}
              size={30}
              marginRight={6}
            />
            <Text style={styles.name}>{agentName}</Text>
          </>
        )}
      </View>
      <View style={styles.marked_box}>
        {hasSteps && thoughtProcessVisible && (
          <CollapsedThoughtProcess
            steps={currentMessage!.steps!}
            onToggle={onReasoningToggle}
          />
        )}
        <TapGestureHandler
          numberOfTaps={2}
          onHandlerStateChange={({ nativeEvent }) => {
            if (nativeEvent.state === State.ACTIVE) {
              handleShowButton();
            }
          }}
        >
          <View>{messageContent}</View>
        </TapGestureHandler>
        {!isUser.current &&
          chatStatus !== ChatStatus.Running &&
          (isLastAIMessage || forceShowButtons) &&
          messageActionButtons}
        {currentMessage.image && (
          <CustomFileListComponent
            files={JSON.parse(currentMessage.image)}
            mode={DisplayMode.Display}
          />
        )}
      </View>
    </View>
  );
};

/** 样式工厂函数, 根据主题颜色, 动态创建组件样式 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    container: {
      marginLeft: 12,
      marginVertical: 4,
    },
    marked_box: {
      marginLeft: 32,
      marginRight: 16,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 0,
    },
    titleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    /** 角色名与头像同权重的外置 header，全强度 15px 对齐 mattermost 口径 */
    name: {
      flex: 1,
      ...typography.body,
      fontWeight: '500',
      color: colors.text,
    },
    /** Agent 回复气泡框，灰底圆角贴左，对齐 demo 与桌面端样式 */
    answerContainer: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: 20,
      borderBottomLeftRadius: 4,
      paddingHorizontal: 16,
      paddingVertical: 10,
      overflow: 'hidden',
    },
    questionContainer: {
      alignSelf: 'flex-end',
      backgroundColor: colors.primary,
      borderRadius: 22,
      overflow: 'hidden',
      marginVertical: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    /** 待注入插话的灰色草稿态气泡 */
    questionContainerQueued: {
      backgroundColor: colors.messageBackground,
    },
    questionText: {
      ...typography.body,
      color: colors.primaryForeground,
    },
    /** 待注入插话的弱化文字 */
    questionTextQueued: {
      color: colors.textSecondary,
    },
    actionButtonsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      marginLeft: -8,
      marginTop: -2,
      marginBottom: 4,
    },
    metricsText: {
      ...typography.body,
      color: colors.textTertiary,
      marginRight: 4,
    },
  });

/** 正文与内联样式的统一字体档，覆盖库默认的大一档字号，与用户消息对齐 */
const messageFont: TextStyle = { ...typography.body };

/** Markdown 富文本渲染的自定义样式配置（标题、列表、表格等间距） */
const customMarkedStyles: MarkedStyles = {
  text: messageFont,
  em: messageFont,
  strong: messageFont,
  strikethrough: messageFont,
  link: messageFont,
  table: { marginVertical: 4 },
  li: { paddingVertical: 4 },
  h1: { ...typography.display },
  h2: { ...typography.display },
  h3: { ...typography.titleDisplay },
  h4: { ...typography.titleDisplay },
  blockquote: { marginVertical: 8 },
  paragraph: { paddingVertical: 6 },
};

/**
 * 导出组件并自定义 memo 比较函数，仅在消息内容、性能指标、Agent 标识等关键属性变化时重渲染。
 * chatStatus 只影响末条 AI 消息的性能指标行显隐，非末行不参与比较，追加消息不再触发全行重渲染。
 * queued 参与比较，插话注入时灰气泡转蓝能当场触发重渲染。
 */
export default React.memo(CustomMessageComponent, (prevProps, nextProps) => {
  return (
    prevProps.currentMessage?.text === nextProps.currentMessage?.text &&
    prevProps.currentMessage?.image === nextProps.currentMessage?.image &&
    prevProps.currentMessage?.steps === nextProps.currentMessage?.steps &&
    prevProps.currentMessage?.metrics === nextProps.currentMessage?.metrics &&
    prevProps.currentMessage?.queued === nextProps.currentMessage?.queued &&
    prevProps.isLastAIMessage === nextProps.isLastAIMessage &&
    (!prevProps.isLastAIMessage ||
      prevProps.chatStatus === nextProps.chatStatus) &&
    prevProps.agentId === nextProps.agentId &&
    prevProps.agentName === nextProps.agentName &&
    prevProps.serverAddress === nextProps.serverAddress
  );
});
