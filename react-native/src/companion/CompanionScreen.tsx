/**
 * @file CompanionScreen.tsx
 * @description Agent 陪伴模式全屏页面。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ChevronLeft, Mic, MicOff, Send } from 'lucide-react-native';
import type { RouteParamList } from '../types/RouteTypes.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import { useVoiceStore } from '../stores/voiceStore';
import {
  ServerClient,
  fetchPoses,
  getBackgroundImageUrl,
  getPoseImageUrl,
} from '../api/server-api.ts';

type Props = NativeStackScreenProps<RouteParamList, 'Companion'>;

/**
 * 底部输入栏子组件。
 */
function CompanionInputBar({
  isLoading,
  onSend,
  bottomInset,
}: {
  isLoading: boolean;
  onSend: (text: string) => Promise<void>;
  bottomInset: number;
}): React.JSX.Element {
  const [inputText, setInputText] = useState('');

  const handlePress = async () => {
    const text = inputText.trim();
    if (!text || isLoading) {
      return;
    }
    setInputText('');
    Keyboard.dismiss();
    await onSend(text);
  };

  const canSend = inputText.trim().length > 0 && !isLoading;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View
        style={[styles.inputBarWrapper, { paddingBottom: bottomInset + 40 }]}
      >
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder="输入消息..."
            placeholderTextColor="#aaa"
            multiline
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              { backgroundColor: canSend ? '#228be6' : '#d8d8d8' },
            ]}
            onPress={handlePress}
            disabled={!canSend}
          >
            <Send size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

interface BackgroundImageProps {
  agentId: string;
  serverAddr: string;
  hasAssets: boolean | null;
  bgError: boolean;
  onBgError: () => void;
  mountTime: React.MutableRefObject<number>;
}

/**
 * 背景图层。
 */
const CompanionBackgroundImage = React.memo(
  function CompanionBackgroundImage({
    agentId,
    serverAddr,
    hasAssets,
    bgError,
    onBgError,
    mountTime,
  }: BackgroundImageProps) {
    if (bgError || hasAssets !== true) {
      return null;
    }
    return (
      <View style={styles.background} pointerEvents="none">
        <Image
          source={{ uri: getBackgroundImageUrl(agentId, serverAddr) }}
          style={StyleSheet.absoluteFillObject}
          onLoad={() => {
            console.log(
              `[Companion] background loaded in ${
                Date.now() - mountTime.current
              }ms`
            );
          }}
          onError={() => {
            console.log('[Companion] background load failed');
            onBgError();
          }}
          resizeMode="cover"
        />
      </View>
    );
  },
  (prev, next) =>
    prev.agentId === next.agentId &&
    prev.serverAddr === next.serverAddr &&
    prev.hasAssets === next.hasAssets &&
    prev.bgError === next.bgError &&
    prev.onBgError === next.onBgError
);

interface PoseImageProps {
  agentId: string;
  serverAddr: string;
  hasAssets: boolean | null;
  poseError: boolean;
  currentPose: string;
  onPoseError: () => void;
  mountTime: React.MutableRefObject<number>;
}

/**
 * 立绘图层。
 */
const CompanionPoseImage = React.memo(
  function CompanionPoseImage({
    agentId,
    serverAddr,
    hasAssets,
    poseError,
    currentPose,
    onPoseError,
    mountTime,
  }: PoseImageProps) {
    if (!hasAssets || poseError) {
      return null;
    }
    return (
      <View style={styles.pose} pointerEvents="none">
        <Image
          source={{
            uri: getPoseImageUrl(agentId, currentPose, serverAddr),
          }}
          style={StyleSheet.absoluteFillObject}
          onLoad={() => {
            console.log(
              `[Companion] pose ${currentPose} loaded in ${
                Date.now() - mountTime.current
              }ms`
            );
          }}
          onError={() => {
            console.log(`[Companion] pose ${currentPose} load failed`);
            onPoseError();
          }}
          resizeMode="contain"
        />
      </View>
    );
  },
  (prev, next) =>
    prev.agentId === next.agentId &&
    prev.serverAddr === next.serverAddr &&
    prev.hasAssets === next.hasAssets &&
    prev.poseError === next.poseError &&
    prev.currentPose === next.currentPose &&
    prev.onPoseError === next.onPoseError
);

interface UIProps {
  hasAssets: boolean | null;
  isLoading: boolean;
  replyText: string;
  onSend: (text: string) => Promise<void>;
  onBack: () => void;
  voiceEnabled: boolean;
  isSpeaking: boolean;
  onToggleVoice: () => void;
  insets: { top: number; bottom: number };
}

/**
 * UI 控件层：返回按钮 + 无资源提示 + 回复气泡 + 输入栏。
 */
const CompanionUI = React.memo(
  function CompanionUI({
    hasAssets,
    isLoading,
    replyText,
    onSend,
    onBack,
    voiceEnabled,
    isSpeaking,
    onToggleVoice,
    insets,
  }: UIProps) {
    return (
      <View style={styles.uiLayer}>
        {hasAssets === false && (
          <View style={styles.centerContent}>
            <Text style={styles.noAssetTitle}>该 Agent 还未配置陪伴形象</Text>
            <Text style={styles.noAssetHint}>
              在 assets/pose/ 目录下添加表情图片即可启用
            </Text>
          </View>
        )}

        {hasAssets === true && (
          <>
            <View style={styles.spacer} pointerEvents="none" />

            {replyText.length > 0 && (
              <View style={styles.bubbleOuter}>
                <View style={styles.bubbleInner}>
                  <ScrollView style={styles.bubbleScroll} nestedScrollEnabled>
                    <Text style={styles.bubbleText}>{replyText}</Text>
                  </ScrollView>
                </View>
              </View>
            )}

            {isLoading && replyText.length === 0 && (
              <View style={styles.bubbleOuter}>
                <View style={styles.bubbleInner}>
                  <Text style={styles.bubbleThinking}>思考中...</Text>
                </View>
              </View>
            )}

            <CompanionInputBar
              isLoading={isLoading}
              onSend={onSend}
              bottomInset={insets.bottom}
            />
          </>
        )}

        <TouchableOpacity
          onPress={onBack}
          style={[styles.backButton, { top: insets.top + 12 }]}
        >
          <ChevronLeft size={22} color="#333" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onToggleVoice}
          style={[styles.micButton, { top: insets.top + 12 }]}
        >
          {voiceEnabled ? (
            <Mic size={20} color={isSpeaking ? '#228be6' : '#333'} />
          ) : (
            <MicOff size={20} color="#999" />
          )}
        </TouchableOpacity>
      </View>
    );
  },
  /**
   * 自定义比较函数：只有这些 props 变化时才 re-render。
   */
  (prev, next) =>
    prev.hasAssets === next.hasAssets &&
    prev.isLoading === next.isLoading &&
    prev.replyText === next.replyText &&
    prev.onSend === next.onSend &&
    prev.onBack === next.onBack &&
    prev.voiceEnabled === next.voiceEnabled &&
    prev.isSpeaking === next.isSpeaking &&
    prev.onToggleVoice === next.onToggleVoice
);

function CompanionScreen({ navigation, route }: Props): React.JSX.Element {
  const agentId = route.params.agentId;
  const voiceId = route.params.voiceId;
  const serverAddr = getServerAddress();
  const mountTime = useRef(Date.now());
  const insets = useSafeAreaInsets();

  /**
   * Agent 是否拥有陪伴资源（三态）：
   *   null  → 加载中（尚未收到 fetchPoses 响应）
   *   true  → 有 pose 图片，展示背景 + 立绘 + 输入栏
   *   false → 无资源或请求失败，显示"未配置陪伴形象"提示
   */
  const [hasAssets, setHasAssets] = useState<boolean | null>(null);

  /** 背景图加载失败时隐藏该层，露出灰色兜底层 */
  const [bgError, setBgError] = useState(false);

  /** 立绘图加载失败时隐藏该层，避免显示破损图片占位 */
  const [poseError, setPoseError] = useState(false);

  /**
   * 当前展示的姿态名称。默认 'default'
   */
  const [currentPose, setCurrentPose] = useState('default');
  const [isLoading, setIsLoading] = useState(false);
  const [replyText, setReplyText] = useState('');

  /** ServerClient 实例引用，用于发送消息和断开连接 */
  const serverClientRef = useRef<ServerClient | null>(null);

  /** 回复文本的 ref 同步，供 onComplete 回调中读取最新值 */
  const replyTextRef = useRef(replyText);
  useEffect(() => {
    replyTextRef.current = replyText;
  }, [replyText]);

  const voiceEnabled = useVoiceStore((s) => s.voiceEnabled);
  const isSpeaking = useVoiceStore((s) => s.isSpeaking);
  const toggleVoice = useVoiceStore((s) => s.toggleVoice);
  const speak = useVoiceStore((s) => s.speak);
  const stopSpeaking = useVoiceStore((s) => s.stopSpeaking);

  const voiceEnabledRef = useRef(voiceEnabled);
  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  const handleToggleVoice = useCallback(() => {
    toggleVoice();
    if (voiceEnabled) {
      stopSpeaking();
    }
  }, [toggleVoice, voiceEnabled, stopSpeaking]);

  /**
   * 当前会话 ID。
   * 从路由参数初始化；若无则延迟到首次发送时自动创建。
   */
  const sessionIdRef = useRef(route.params.sessionId || '');

  /**
   * 页面挂载时请求 Agent 的 pose 列表，判断是否有陪伴资源。
   * 使用 cancelled 标志防止组件卸载后的异步回调执行 setState。
   */
  useEffect(() => {
    if (!agentId) {
      return;
    }
    let cancelled = false;
    setHasAssets(null);
    setBgError(false);
    setPoseError(false);
    mountTime.current = Date.now();
    console.log(`[Companion] mount agentId=${agentId}`);
    fetchPoses(agentId, serverAddr)
      .then((poses) => {
        console.log(
          `[Companion] poses loaded: ${poses.length} in ${
            Date.now() - mountTime.current
          }ms`
        );
        if (!cancelled) {
          setHasAssets(poses.length > 0);
        }
      })
      .catch(() => {
        console.log('[Companion] fetchPoses failed');
        if (!cancelled) {
          setHasAssets(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, serverAddr]);

  /**
   * WebSocket 连接生命周期管理。
   *
   * 页面获得焦点时：创建 ServerClient → 注册回调 → 连接 → 可选 subscribe。
   * 页面失去焦点时：断开连接 → 清理引用。
   *
   * 回调注册在 connect 之前完成，确保不丢失早期事件。
   * onStepComplete 接收 AI 回复文本（更新回复气泡）和工具调用（提取 show_pose 切换表情）。
   */
  useFocusEffect(
    useCallback(() => {
      if (!serverAddr) {
        return;
      }

      let cancelled = false;
      const client = new ServerClient();

      client.onStepComplete = (content, _thinking, toolCalls) => {
        console.log(
          `[Companion] step_complete: content=${(content || '').substring(
            0,
            80
          )}`
        );
        if (!cancelled) {
          if (content && content.trim().length > 0) {
            setReplyText(content);
          }
          if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              if (tc.name === 'show_pose' && tc.arguments) {
                const pose = tc.arguments.pose as string;
                if (pose) {
                  console.log(`[Companion] pose change: ${pose}`);
                  setCurrentPose(pose);
                  setPoseError(false);
                }
              }
            }
            console.log(
              `[Companion] toolCalls: ${toolCalls
                .map((tc) => tc.name)
                .join(', ')}`
            );
          }
        }
      };
      client.onComplete = () => {
        console.log('[Companion] complete');
        if (!cancelled) {
          setIsLoading(false);
          if (voiceEnabledRef.current && voiceId) {
            const text = replyTextRef.current;
            const sessionId = sessionIdRef.current;
            if (text && sessionId) {
              speak(text, voiceId, agentId, sessionId);
            }
          }
        }
      };
      client.onError = (message) => {
        console.log(`[Companion] error: ${message}`);
        if (!cancelled) {
          setIsLoading(false);
        }
      };

      (async () => {
        try {
          await client.connect(serverAddr);
          if (cancelled) {
            return;
          }
          serverClientRef.current = client;
          console.log('[Companion] WebSocket connected');

          if (sessionIdRef.current) {
            client.subscribe(sessionIdRef.current);
            console.log(
              `[Companion] subscribed to session=${sessionIdRef.current}`
            );
          }
        } catch (e) {
          console.log(`[Companion] connect failed: ${e}`);
        }
      })();

      return () => {
        cancelled = true;
        client.disconnect();
        serverClientRef.current = null;
        stopSpeaking();
        console.log('[Companion] WebSocket disconnected');
      };
    }, [serverAddr, agentId, speak, stopSpeaking, voiceId])
  );

  /**
   * 发送消息流程（由 CompanionInputBar 通过 onSend 回调触发）：
   * 1. 若无 sessionId → 自动创建 session 并 subscribe
   * 2. 通过 HTTP POST 发送，AI 回复经 WebSocket 异步到达
   */
  const handleSend = useCallback(
    async (text: string) => {
      setIsLoading(true);
      setReplyText('');

      try {
        const client = serverClientRef.current;
        if (!client) {
          setIsLoading(false);
          return;
        }

        let sessionId = sessionIdRef.current;
        if (!sessionId) {
          sessionId = await client.createSession(agentId, serverAddr);
          sessionIdRef.current = sessionId;
          client.subscribe(sessionId);
          console.log(`[Companion] created session=${sessionId}`);
        }

        await client.sendChatMessage(agentId, sessionId, text, serverAddr);
      } catch (e) {
        console.log(`[Companion] send failed: ${e}`);
        setIsLoading(false);
      }
    },
    [agentId, serverAddr]
  );

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);
  const handleBgError = useCallback(() => setBgError(true), []);
  const handlePoseError = useCallback(() => setPoseError(true), []);

  return (
    <View style={styles.container}>
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle="dark-content"
      />
      <CompanionBackgroundImage
        agentId={agentId}
        serverAddr={serverAddr}
        hasAssets={hasAssets}
        bgError={bgError}
        onBgError={handleBgError}
        mountTime={mountTime}
      />
      <CompanionPoseImage
        agentId={agentId}
        serverAddr={serverAddr}
        hasAssets={hasAssets}
        poseError={poseError}
        currentPose={currentPose}
        onPoseError={handlePoseError}
        mountTime={mountTime}
      />
      <CompanionUI
        hasAssets={hasAssets}
        isLoading={isLoading}
        replyText={replyText}
        onSend={handleSend}
        onBack={handleBack}
        voiceEnabled={voiceEnabled}
        isSpeaking={isSpeaking}
        onToggleVoice={handleToggleVoice}
        insets={{ top: insets.top, bottom: insets.bottom }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#e5e5e5',
  },
  background: {
    ...StyleSheet.absoluteFillObject,
  },
  pose: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '85%',
    alignItems: 'center',
  },
  uiLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  backButton: {
    position: 'absolute',
    top: 56,
    left: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  micButton: {
    position: 'absolute',
    top: 56,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  noAssetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#555',
    textAlign: 'center',
    lineHeight: 26,
  },
  noAssetHint: {
    fontSize: 14,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 22,
  },
  spacer: {
    flex: 1,
  },
  bubbleOuter: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  bubbleInner: {
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  bubbleScroll: {
    maxHeight: 160,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  bubbleText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 22,
  },
  bubbleThinking: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  inputBarWrapper: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  textInput: {
    flex: 1,
    color: '#333',
    fontSize: 16,
    maxHeight: 120,
    paddingTop: 0,
    paddingBottom: 0,
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});

export default CompanionScreen;
