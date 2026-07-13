/**
 * @file CustomMessageComponent.tsx
 * @description 聊天消息渲染组件 - 负责渲染每条消息的 UI（头部、思考过程、正文、操作按钮、附件）
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  RefObject,
} from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Share from 'react-native-share';
import { MessageProps } from 'react-native-gifted-chat';
import { CustomMarkdownRenderer } from './markdown/CustomMarkdownRenderer.tsx';
import { MarkedStyles } from 'react-native-marked/src/theme/types.ts';
import { ChatStatus, PressMode, ChatMessage } from '../../types/Chat.ts';
import { trigger } from '../util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src/types.ts';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  CustomFileListComponent,
  DisplayMode,
} from './CustomFileListComponent.tsx';
import FileViewer from 'react-native-file-viewer';
import { logger } from '../../lib/logger';
import { CustomTokenizer } from './markdown/CustomTokenizer.ts';
import Markdown from './markdown/Markdown.tsx';
import LoadingSpinner from './LoadingSpinner.tsx';
import { State, TapGestureHandler } from 'react-native-gesture-handler';
import { useTheme, ColorScheme } from '../../theme/index.ts';
import { Check, Copy } from 'lucide-react-native';
import i18n from '../../i18n/index.ts';
import CollapsedThoughtProcess from './CollapsedThoughtProcess.tsx';

/** 组件 Props 类型定义，继承自 GiftedChat 的 MessageProps，扩展了聊天状态等属性 */
interface CustomMessageProps extends MessageProps<ChatMessage> {
  chatStatus: ChatStatus;
  isLastAIMessage?: boolean;
  onReasoningToggle?: (
    expanded: boolean,
    height: number,
    animated: boolean
  ) => void;
  messageIndex?: number;
  flatListRef?: RefObject<FlatList<ChatMessage>>;
}

const { width: screenWidth } = Dimensions.get('window');

/** 自定义消息渲染组件：根据消息类型（用户/AI）渲染不同的 UI 层（头部、思考过程、正文、操作按钮、附件） */
const CustomMessageComponent: React.FC<CustomMessageProps> = ({
  currentMessage,
  chatStatus,
  isLastAIMessage,
  onReasoningToggle,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [copied, setCopied] = useState(false);
  const [clickTitleCopied, setClickTitleCopied] = useState(false);
  const chatStatusRef = useRef(chatStatus);
  const [forceShowButtons, setForceShowButtons] = useState(false);
  const isUser = useRef(currentMessage?.user?._id === 1);

  const isLoading =
    chatStatus === ChatStatus.Running &&
    (currentMessage?.text === '...' || currentMessage?.text === '');

  const toggleButtons = useCallback(() => {
    setForceShowButtons((prev) => !prev);
  }, []);

  const handleCopy = useCallback(() => {
    const copyText = currentMessage?.text.trim() || '';
    Clipboard.setString(copyText);
  }, [currentMessage?.text]);

  const userInfo = useMemo(() => {
    if (!currentMessage || !currentMessage.user) {
      return { userName: '', avatar: '' };
    }
    return {
      userName: currentMessage.user.name ?? 'AI',
      avatar: currentMessage.user.avatar as string | undefined,
    };
  }, [currentMessage]);

  const headerContent = useMemo(() => {
    return (
      <>
        <Image source={{ uri: userInfo.avatar }} style={styles.avatar} />
        <Text style={styles.name}>{userInfo.userName}</Text>
      </>
    );
  }, [userInfo, styles.avatar, styles.name]);

  const copyButton = useMemo(() => {
    return clickTitleCopied ? (
      <View style={styles.copy}>
        <Check size={18} color={colors.text} />
      </View>
    ) : null;
  }, [clickTitleCopied, colors.text, styles.copy]);

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
    if (!isLoading) {
      toggleButtons();
    }
  }, [isLoading, toggleButtons]);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => {
        setCopied(false);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [copied]);

  useEffect(() => {
    if (clickTitleCopied) {
      handleCopy();
      const timer = setTimeout(() => {
        setClickTitleCopied(false);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [handleCopy, clickTitleCopied]);

  const messageContent = useMemo(() => {
    if (!currentMessage) {
      return null;
    }

    if (!isUser.current) {
      return (
        <Markdown
          value={currentMessage.text}
          styles={customMarkedStyles}
          renderer={customMarkdownRenderer}
          tokenizer={customTokenizer}
          chatStatus={chatStatusRef.current}
        />
      );
    }

    return (
      <View
        style={{
          ...styles.questionContainer,
          maxWidth: (screenWidth * 3) / 4,
        }}
      >
        <Text style={styles.questionText} selectable>
          {currentMessage.text}
        </Text>
      </View>
    );
  }, [
    currentMessage,
    customMarkdownRenderer,
    customTokenizer,
    styles.questionContainer,
    styles.questionText,
  ]);

  const messageActionButtons = useMemo(() => {
    const metricsText = currentMessage?.metrics
      ? `latency ${currentMessage.metrics.latencyMs}s | ${currentMessage.metrics.speed} tok/s`
      : null;
    return (
      <View style={styles.actionButtonsContainer}>
        <View style={styles.actionButtonInnerContainer}>
          <TouchableOpacity
            onPress={() => {
              handleCopy();
              setCopied(true);
            }}
            style={styles.actionButton}
          >
            {copied ? (
              <Check size={16} color={colors.textSecondary} />
            ) : (
              <Copy size={16} color={colors.textSecondary} />
            )}
          </TouchableOpacity>
        </View>

        {metricsText && <Text style={styles.metricsText}>{metricsText}</Text>}
      </View>
    );
  }, [
    handleCopy,
    copied,
    currentMessage?.metrics,
    colors.textSecondary,
    styles.actionButtonsContainer,
    styles.actionButtonInnerContainer,
    styles.actionButton,
    styles.metricsText,
  ]);

  if (!currentMessage) {
    return null;
  }
  const hasSteps = (currentMessage?.steps?.length ?? 0) > 0;
  const showLoading = isLoading && !hasSteps;
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={1}
        onPress={() => setClickTitleCopied(true)}
      >
        {!isUser.current && headerContent}
        {copyButton}
      </TouchableOpacity>
      <View style={styles.marked_box}>
        {hasSteps && (
          <CollapsedThoughtProcess
            steps={currentMessage!.steps!}
            onToggle={onReasoningToggle}
          />
        )}
        {showLoading && (
          <View style={styles.loadingContainer}>
            <LoadingSpinner visible={true} size={18} />
          </View>
        )}
        {!isLoading && (
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
        )}
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
      marginLeft: 28,
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
    avatar: {
      width: 22,
      height: 22,
      borderRadius: 11,
      marginRight: 6,
    },
    copy: {
      marginRight: 20,
      marginLeft: 'auto',
    },
    name: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
      color: colors.text,
    },
    questionContainer: {
      alignSelf: 'flex-end',
      backgroundColor: colors.messageBackground,
      borderRadius: 22,
      overflow: 'hidden',
      marginVertical: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    questionText: {
      lineHeight: 24,
      fontSize: 16,
      color: colors.text,
    },
    loadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 12,
      marginBottom: 10,
    },
    actionButtonsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginLeft: -8,
      marginTop: -2,
      marginBottom: 4,
    },
    actionButtonInnerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    actionButton: {
      padding: 8,
    },
    metricsText: {
      fontSize: 12,
      color: colors.textTertiary,
      marginRight: 4,
    },
  });

/** Markdown 富文本渲染的自定义样式配置（标题、列表、表格等间距） */
const customMarkedStyles: MarkedStyles = {
  table: { marginVertical: 4 },
  li: { paddingVertical: 4 },
  h1: { fontSize: 28 },
  h2: { fontSize: 24 },
  h3: { fontSize: 20 },
  h4: { fontSize: 18 },
  blockquote: { marginVertical: 8 },
  paragraph: { paddingVertical: 6 },
};

/** 导出组件并自定义 memo 比较函数，仅在消息内容、状态、索引等关键属性变化时才重新渲染 */
export default React.memo(CustomMessageComponent, (prevProps, nextProps) => {
  return (
    prevProps.currentMessage?.text === nextProps.currentMessage?.text &&
    prevProps.currentMessage?.image === nextProps.currentMessage?.image &&
    prevProps.currentMessage?.steps === nextProps.currentMessage?.steps &&
    prevProps.chatStatus === nextProps.chatStatus &&
    prevProps.isLastAIMessage === nextProps.isLastAIMessage &&
    prevProps.messageIndex === nextProps.messageIndex
  );
});
