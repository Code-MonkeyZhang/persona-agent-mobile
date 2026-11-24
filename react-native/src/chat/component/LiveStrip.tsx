/**
 * @file LiveStrip.tsx
 * @description 会话时间线的行语言底座与顶栏时间线组件。
 *   - 行语言在手机端只此一处定义，消息内思考过程与顶栏时间线都从这里取口径
 *   - 摘要与动向句纯函数在 src/lib/tool-summary.ts，那是共享包的整块镜像，
 *     本体无 Grep 与 WebSearch，映射键按工具短名登记，未登记工具回退扳手
 *   - 时间线三档浮在消息区上方不占布局，消息区高度恒定，行数据从消息流加运行态推导不新增存储
 *   - 行纯展示不可点，详情弹层与压缩行的摘要查看只在桌面端，压缩行在移动端同样不可点
 *   - 档位偏好经本地存储跨启动记忆，只记 line 与 hair 两态，中止的轮次不落盘，时间线上它没有发生过
 *   - 连接横幅在位时整层让位到横幅下方，横幅收走滑回顶部
 *   - 压缩行一次压缩一条随会话持久化，消息侧无逐条真实时间戳可锚，记录间按 at 升序
 *     落在历史尾部，运行中的记录压轴由运行态合成补位
 */
import { useEffect, useMemo, useState } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import CachedImage from '../../component/CachedImage';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  CheckCircle,
  ChevronUp,
  FilePlus,
  FileText,
  Globe,
  Lightbulb,
  MessageCircle,
  MessageSquare,
  MessageSquareDashed,
  Minimize2,
  Pencil,
  Smile,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../lib/logger.ts';
import {
  shortToolName,
  stepPhrase,
  summarizeToolInput,
} from '../../lib/tool-summary.ts';
import { useChatStore, EMPTY_MESSAGES, BOT_ID } from '../../stores/chatStore';
import type { CompressionRuntimeState } from '../../stores/chatStore';
import type { GeneratingPhase } from '../../stores/performanceEngine.ts';
import type { CompressionRecord } from '../../storage/sync-shapes.ts';
import { BANNER_HEIGHT, useBannerPresence } from '../../home/ConnectionBanner';
import {
  getStripCollapsed,
  saveStripCollapsed,
} from '../../storage/StorageUtils';
import { FileType, type ChatMessage, type FileInfo } from '../../types/Chat';
import type { Thought } from '../../types/Thought';
import { useTheme, typography } from '../../theme';

/** 时间线行与消息内面板共用的时间线规格色值，取自设计文档与桌面实现，不进主题 token */
export const ROW_ICON = '#8E8E93';
export const FAIL_RED = '#d5392e';

/** 压缩行强调色，与占用小壳主色同源 */
const COMPRESS_BLUE = '#007AFF';

/** token 数格式化成 79.4k 的一位小数口径，压缩行对比与占用面板头行共用 */
export const formatK = (tokens: number) => `${(tokens / 1000).toFixed(1)}k`;

/** 实时步骤条的一步，tool 为空串代表文字步，detail 是参数摘要或文字步正文
 *  text 标记模型文字步，渲染时按后面跟不跟工具分中间解说行与回复内容行
 *  toolTitle 是模型自写的调用短标题，显示取值链第一优先
 *  iconUrl 是 MCP 工具所属服务的 logo 图址，缺失回退 Wrench
 *  failed 标记工具步失败，行渲染走红字紧跟 circle-x */
export interface LiveStep {
  tool: string;
  detail: string;
  startedAt: number;
  endedAt?: number;
  text?: boolean;
  toolTitle?: string;
  iconUrl?: string;
  failed?: boolean;
}

/** 运行期时间线的实时状态，sessionId 归属防串台，null 表示空闲
 *  replying 标记模型正在产出正文，content_started 到达置位，步落行后复位 */
export interface LiveRunState {
  sessionId: string;
  steps: LiveStep[];
  replying?: boolean;
}

/** i18n 文案函数的最小形状，供纯函数共用 */
export type Translate = (key: string, opts?: Record<string, unknown>) => string;

/** 图标组件的最小形状，lucide 图标与回退图标都满足 */
type IconComponent = ComponentType<{
  size?: number;
  color?: string;
}>;

/** 工具短名到行前置位身份图标的映射，内置工具全量登记，未登记的第三方工具回退扳手 */
const TOOL_ICONS: Record<string, IconComponent> = {
  read_file: FileText,
  write_file: FilePlus,
  edit_file: Pencil,
  bash: TerminalSquare,
  bash_output: TerminalSquare,
  bash_kill: TerminalSquare,
  web_fetch: Globe,
  show_pose: Smile,
  get_current_pose: Smile,
};

/**
 * 取工具步的身份图标，行前置位任何时候都是身份图标，成功失败不抢图标位
 * 全名先剥条目前缀再查表，MCP 工具的身份由 iconUrl 图址承担，这里只兜无图址的展示位
 * @param tool 工具全名或短名
 */
export function toolIcon(tool: string): IconComponent {
  return TOOL_ICONS[shortToolName(tool)] ?? Wrench;
}

/**
 * 消息内思考过程行的适配器，把 Thought 的 toolInput 经摘要转成动向句
 * 思考行与错误行原样返回正文
 * @param t 文案函数
 * @param thought 待叙述的思考步骤
 */
export function phraseForThought(t: Translate, thought: Thought): string {
  if (thought.type !== 'tool_use') return thought.content ?? '';
  return stepPhrase(t, {
    tool: thought.toolName ?? '',
    detail: summarizeToolInput(thought.toolName ?? '', thought.toolInput),
    startedAt: 0,
    endedAt: 1,
    toolTitle: thought.toolTitle,
  });
}

/**
 * 取最后一个未闭合的工具步，没有则返回 undefined
 * 未闭合的步只可能是工具步，文字步落行时就带结束时间
 * @param liveRun 当前回合的实时状态
 */
export function activeToolStep(liveRun: LiveRunState): LiveStep | undefined {
  return [...liveRun.steps]
    .reverse()
    .find((s) => s.tool !== '' && s.endedAt === undefined);
}

/**
 * 状态条当前动作文案推导，三态纯函数，有未闭合工具步则工具执行叙述，
 * 无活动步且正文写作中返回正在回复，其余思考中
 * @param t 文案函数
 * @param liveRun 当前回合的实时状态
 */
export function liveRunLabel(t: Translate, liveRun: LiveRunState): string {
  const active = activeToolStep(liveRun);
  if (active) return stepPhrase(t, active);
  return liveRun.replying ? t('live.replying') : t('live.thinking');
}

/**
 * 顶条图标位随相位换身份图标，三态纯函数，活动工具步取工具身份，
 * 正文写作中取方形气泡，其余灯泡
 * @param liveRun 当前回合的实时状态
 */
export function phaseIcon(liveRun: LiveRunState): IconComponent {
  const active = activeToolStep(liveRun);
  if (active) return toolIcon(active.tool);
  return liveRun.replying ? MessageSquare : Lightbulb;
}

/**
 * 从实时状态推出陪伴舞台的生成相位，思考气泡据此出入场，与顶条的文案和图标同出一份推导
 * 有未闭合的工具步是 tool，带写作标志是 replying，其余 thinking，空闲传 null
 * @param liveRun 当前回合的实时状态，空闲传 null
 */
export function deriveLivePhase(liveRun: LiveRunState | null): GeneratingPhase {
  if (!liveRun) return 'idle';
  if (activeToolStep(liveRun)) return 'tool';
  return liveRun.replying ? 'replying' : 'thinking';
}

/** 时间线行数据，kind 区分六类条目，live 标记运行期未闭合的活动行
 *  synthetic 标记思考间隙与写作期补出的活动行，文本渲染时取文案不存值
 *  note 是模型中间解说，reply 是回复内容
 *  compress 是压缩记录行，一次压缩一条随会话持久化，移动端纯展示不可点 */
export type TimelineRowData =
  | { kind: 'user'; text: string }
  | { kind: 'think'; text: string; live?: boolean; synthetic?: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'reply'; text: string; live?: boolean; synthetic?: boolean }
  | {
      kind: 'tool';
      tool: string;
      detail: string;
      toolTitle?: string;
      iconUrl?: string;
      live?: boolean;
      failed?: boolean;
    }
  | { kind: 'compress'; record: CompressionRecord };

/** 状态条用户行的显示文案。正文与附件占位依次空格拼接，空段自动省略。
 * 图片占位固定为 Image 加真实后缀，不随会话内外变化；文件占位为原始文件名带后缀。
 * 附件载荷沿用消息 image 字段的 JSON 约定，旧载荷解析失败按无附件处理。 */
export function userRowText(message: ChatMessage): string {
  const parts: string[] = [];
  if (message.text.length > 0) {
    parts.push(message.text);
  }
  if (!message.image) {
    return parts.join(' ');
  }
  let files: FileInfo[] = [];
  try {
    files = JSON.parse(message.image) as FileInfo[];
  } catch {
    return parts.join(' ');
  }
  for (const file of files) {
    if (file.type !== FileType.image) {
      parts.push(file.fileName);
      continue;
    }
    const dot = file.fileName.lastIndexOf('.');
    const ext =
      (dot >= 0 ? file.fileName.slice(dot + 1).toLowerCase() : '') ||
      file.format;
    parts.push(`Image.${ext === 'jpeg' ? 'jpg' : ext}`);
  }
  return parts.join(' ');
}

/**
 * 把会话消息流摊平成时间线行，顺序即发生顺序。
 * GiftedChat 数组新在前，先倒序摊平还原时间正序。
 * 用户消息出用户行充当轮次锚点，助手消息的思考段出思考行，工具调用出工具行带参数摘要，
 * 落盘消息的中间解说轮末收起不进行，助手正文非空出回复内容行给整轮收尾。
 * 落盘行与运行行的失败判定同源，读 thought 的 isError 与 toolResult 的 isError。
 * 压缩记录随会话持久化，记录间按 at 升序，消息侧无逐条真实时间戳可锚，历史记录
 * 落在全部消息行之后，运行中的记录压轴，meta 未带到时由运行态合成一行补位。
 * 运行期 liveRun 的步骤作为活动尾巴接在末尾，当前轮的消息还没落盘由它补齐，
 * 文字步按后面跟不跟工具定性，跟了出中间解说行，没跟出回复内容行，
 * 运行中没有未闭合工具步时按相位补活动行，写作期补正在回复标记，间隙补思考中。
 * @param messages 当前会话消息流，新在前
 * @param liveRun 运行期实时状态，空闲或归属不符传 null
 * @param compressionRecords 压缩记录清单，按发生时间升序，无记录传空
 * @param compressionRuntime 压缩运行态，空闲传 null
 */
export function buildRows(
  messages: ChatMessage[],
  liveRun: LiveRunState | null,
  compressionRecords: CompressionRecord[] = [],
  compressionRuntime: CompressionRuntimeState | null = null
): TimelineRowData[] {
  const rows: TimelineRowData[] = [];
  for (const m of [...messages].reverse()) {
    if (m.user._id === 1) {
      rows.push({ kind: 'user', text: userRowText(m) });
      continue;
    }
    for (const th of m.steps ?? []) {
      if (th.type === 'tool_use') {
        rows.push({
          kind: 'tool',
          tool: th.toolName ?? '',
          detail: summarizeToolInput(th.toolName ?? '', th.toolInput),
          toolTitle: th.toolTitle,
          iconUrl: th.iconUrl,
          failed: th.isError || th.toolResult?.isError || undefined,
        });
      } else if (th.type === 'thinking' && th.content) {
        rows.push({ kind: 'think', text: th.content });
      }
    }
    if (m.text) {
      rows.push({ kind: 'reply', text: m.text });
    }
  }
  // 历史记录落在消息行之后，运行行之前，记录间保持时间升序
  const landedRecords = compressionRecords.filter((r) => r.state !== 'running');
  for (const r of landedRecords) {
    rows.push({ kind: 'compress', record: r });
  }
  if (liveRun) {
    liveRun.steps.forEach((st, i) => {
      const live = st.endedAt === undefined;
      if (st.tool === '') {
        if (st.text) {
          // 文字定性纯推导，后面还有工具步即中间解说，否则是候选的回复内容
          const hasToolAfter = liveRun.steps
            .slice(i + 1)
            .some((s) => s.tool !== '');
          rows.push(
            hasToolAfter
              ? { kind: 'note', text: st.detail }
              : { kind: 'reply', text: st.detail }
          );
        } else {
          rows.push({ kind: 'think', text: st.detail, live });
        }
      } else {
        rows.push({
          kind: 'tool',
          tool: st.tool,
          detail: st.detail,
          toolTitle: st.toolTitle,
          iconUrl: st.iconUrl,
          live,
          failed: st.failed,
        });
      }
    });
    if (!liveRun.steps.some((s) => s.tool !== '' && s.endedAt === undefined)) {
      rows.push(
        liveRun.replying
          ? { kind: 'reply', text: '', live: true, synthetic: true }
          : { kind: 'think', text: '', live: true, synthetic: true }
      );
    }
  }
  // 运行中的压缩行压轴，meta 已带同 id 记录时直接用它，未带到由运行态合成补位
  const runningRecords = compressionRecords.filter(
    (r) => r.state === 'running'
  );
  for (const r of runningRecords) {
    rows.push({ kind: 'compress', record: r });
  }
  if (
    compressionRuntime &&
    (compressionRuntime.phase === 'running' ||
      compressionRuntime.phase === 'retry') &&
    !runningRecords.some((r) => r.id === compressionRuntime.recordId)
  ) {
    rows.push({
      kind: 'compress',
      // 合成记录的 trigger 与 at 不参与渲染，仅满足记录类型，meta 同步后由真实记录顶替
      record: {
        id: compressionRuntime.recordId,
        state: 'running',
        trigger: 'manual',
        attempt: compressionRuntime.attempt,
        before: null,
        after: null,
        at: Date.now(),
      },
    });
  }
  return rows;
}

/** 展开区时间线的高度上限，超出内部滚动 */
const PANEL_MAX_H = 288;

/** 行档全高 36 加下描边 1，与消息区顶部留位常量互引 */
const BAR_H = 37;

/** 发丝线档热区全高，胶囊占顶上 6 加 4 */
const HAIR_ZONE_H = 20;

/** 发丝线档胶囊宽 64 高 4 圆角 2，距 header 下缘 6px，热区全宽 20px */
const CAPSULE_W = 64;
const HAIR_THICKNESS = 4;
const BAND_W = Math.round(CAPSULE_W * 0.4);

/** 运行态胶囊轨道的淡蓝底与空闲态灰 */
const SEAM_TRACK = '#007AFF26';
const SEAM_IDLE = '#D1D1D6';

/**
 * 空闲态一行档摘要，从最新一条带工具步的助手消息现算步数与失败步数。
 * 失败轮红字优先，消息流末尾是 error 气泡即本轮失败，有失败步数报 doneFail，
 * 零步骤失败轮同样落 roundFail，不回退已回复。
 * 成功轮优先显示模型写的本轮意图，取最后一个工具步的 toolIntent，未写走步数兜底。
 * 零工具步的轮与回退不到任何模型轮的空窗都显示已回复，用户消息原文不上单行。
 * GiftedChat 数组新在前，从头部向尾部扫。
 * @param t 文案函数
 * @param messages 当前会话消息流，新在前
 */
export function idleLabel(
  t: Translate,
  messages: ChatMessage[]
): { text: string; failed: boolean } {
  const errTail = messages[0]?.error === true;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.user._id !== BOT_ID || !m.steps?.length) continue;
    const tools = m.steps.filter((th) => th.type === 'tool_use');
    const fails = tools.filter(
      (th) => th.isError || th.toolResult?.isError
    ).length;
    if (fails > 0) {
      return {
        text: t('live.doneFail', { count: tools.length, fails }),
        failed: true,
      };
    }
    if (errTail) {
      return { text: t('live.roundFail'), failed: true };
    }
    if (tools.length === 0) {
      return { text: t('live.replied'), failed: false };
    }
    const intent = tools[tools.length - 1]?.toolIntent;
    return intent
      ? { text: intent, failed: false }
      : { text: t('live.done', { count: tools.length }), failed: false };
  }
  if (errTail) {
    return { text: t('live.roundFail'), failed: true };
  }
  return { text: t('live.replied'), failed: false };
}

/** 顶条压缩相位的显示形状，mono 是等宽字附注，重试序号或落定对比 */
interface CompressionPhaseView {
  icon: IconComponent;
  label: string;
  mono: string | null;
  dots: boolean;
  failed: boolean;
}

/**
 * 顶条压缩相位显示，运行与重试带圆点与序号，落定亮出前后对比。
 * 失败与真底线同为终态上单行，红字换 XCircle 与时间线压缩行同色。
 * 中断不进运行态，只在时间线压缩行灰字悬置。
 * @param t 文案函数
 * @param state 压缩运行态，空闲无落定记忆返回 null
 */
function compressionPhase(
  t: Translate,
  state: CompressionRuntimeState | null
): CompressionPhaseView | null {
  if (!state) return null;
  if (state.phase === 'running') {
    return {
      icon: Minimize2,
      label: t('live.compressionRunning'),
      mono: null,
      dots: true,
      failed: false,
    };
  }
  if (state.phase === 'retry') {
    return {
      icon: Minimize2,
      label: t('live.compressionRetrying'),
      mono: `(${state.attempt}/3)`,
      dots: true,
      failed: false,
    };
  }
  if (state.phase === 'failed') {
    return {
      icon: XCircle,
      label:
        state.failReason === 'no_material'
          ? t('live.compressionFloorEmpty')
          : t('live.compressionFailed'),
      mono: null,
      dots: false,
      failed: true,
    };
  }
  const landed = state.lastLanded;
  if (!landed) return null;
  const mono =
    landed.before != null && landed.after != null
      ? `${formatK(landed.before)} → ${formatK(landed.after)}`
      : null;
  return {
    icon: Minimize2,
    label: t('live.compressionCompacted'),
    mono,
    dots: false,
    failed: false,
  };
}

/** 顶条三档，line 留一行，open 完全展开，hair 完全收起只剩发丝线 */
type StripMode = 'line' | 'open' | 'hair';

// 档位偏好跨启动落盘，只记 line 与 hair 两态，open 是 line 的展开形态不单独记
let lastMode: StripMode = getStripCollapsed() ? 'hair' : 'line';

/** 单颗呼吸圆点，主色 3px，透明度 0.2 与 1 之间往返单程 600ms，延迟相位差 0.2s */
function BreathingDot({ delayMs }: { delayMs: number }) {
  const opacity = useSharedValue(0.2);
  useEffect(() => {
    opacity.value = withDelay(
      delayMs,
      withRepeat(
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      )
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [delayMs, opacity]);
  const dotStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, dotStyle]} />;
}

/** 运行指示的三颗呼吸圆点，紧跟文字右侧对齐首行，由宿主传间距与偏移，导出供陪伴气泡动向行复用 */
export function Dots({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.dots, style]} pointerEvents="none">
      <BreathingDot delayMs={0} />
      <BreathingDot delayMs={200} />
      <BreathingDot delayMs={400} />
    </View>
  );
}

/**
 * 顶栏会话时间线，挂在 header 下方浮在消息区上方，常驻不退场。
 * 收起一行，运行中图标位随相位换身份图标加一句动向，圆点紧跟动向文字右侧，
 * 空闲从消息流现算本轮摘要，成功绿对勾加执行了 N 个步骤，失败轮对勾消失整句红字。
 * 点条本体完全展开，展开区是整个会话的过程记录，右缘箭头收到发丝线档。
 * 展开区贴底跟随走原生 maintainVisibleContentPosition，新行自动跟底上翻不拽。
 */
export function LiveStrip() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const displayedSessionId = useChatStore((s) => s.displayedSessionId);
  const messages = useChatStore(
    (s) => s.sessions[s.displayedSessionId]?.messages ?? EMPTY_MESSAGES
  );
  const liveRun = useChatStore((s) => s.liveRun);
  const compressionState = useChatStore(
    (s) => s.compressionStates.get(s.displayedSessionId) ?? null
  );
  const compressionRecords = useChatStore(
    (s) => s.compressionLogs.get(s.displayedSessionId) ?? EMPTY_RECORDS
  );
  const [mode, setMode] = useState<StripMode>(lastMode);
  const [panelContentH, setPanelContentH] = useState(0);
  const panelH = useSharedValue(0);
  const shellH = useSharedValue(BAR_H);
  const barOpacity = useSharedValue(1);
  const capsuleOpacity = useSharedValue(0);
  const bannerOffset = useSharedValue(0);
  const bannerVisible = useBannerPresence((s) => s.visible);

  const running = !!liveRun && liveRun.sessionId === displayedSessionId;
  const rows = useMemo(
    () =>
      buildRows(
        messages,
        running ? liveRun : null,
        compressionRecords,
        compressionState
      ),
    [messages, running, liveRun, compressionRecords, compressionState]
  );

  const applyMode = (next: StripMode) => {
    lastMode = next;
    if (next !== 'open') {
      saveStripCollapsed(next === 'hair');
    }
    setMode(next);
  };

  const cappedPanelH =
    panelContentH > 0 ? Math.min(panelContentH, PANEL_MAX_H) : PANEL_MAX_H;

  // 三档切换动画：壳高在条子档与发丝线档之间收放，条子层与胶囊层交叉淡化
  useEffect(() => {
    panelH.value = withTiming(mode === 'open' ? cappedPanelH : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
    shellH.value = withTiming(
      mode === 'hair'
        ? HAIR_ZONE_H
        : BAR_H + (mode === 'open' ? cappedPanelH : 0),
      { duration: 250, easing: Easing.inOut(Easing.quad) }
    );
    const toHair = mode === 'hair';
    barOpacity.value = withTiming(toHair ? 0 : 1, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
    capsuleOpacity.value = withTiming(toHair ? 1 : 0, {
      duration: 180,
      easing: Easing.out(Easing.quad),
    });
  }, [mode, cappedPanelH, panelH, shellH, barOpacity, capsuleOpacity]);

  // 连接横幅在位时整层让位一个横幅高度，三档一并平移，收走滑回
  useEffect(() => {
    bannerOffset.value = withTiming(bannerVisible ? BANNER_HEIGHT : 0, {
      duration: 250,
      easing: Easing.inOut(Easing.quad),
    });
  }, [bannerVisible, bannerOffset]);

  // 倒置列表展示新在前数据，倒序回时间正序让最新行贴视觉底
  const panelData = useMemo(() => [...rows].reverse(), [rows]);
  const panelStyle = useAnimatedStyle(() => ({ height: panelH.value }));
  const shellStyle = useAnimatedStyle(() => ({ height: shellH.value }));
  const barStyle = useAnimatedStyle(() => ({ opacity: barOpacity.value }));
  const capsuleStyle = useAnimatedStyle(() => ({
    opacity: capsuleOpacity.value,
  }));
  const layerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bannerOffset.value }],
  }));

  if (!running && rows.length === 0) {
    return null;
  }

  // 压缩相位显示，模型运行态优先让位，让位后不复活直到下一次压缩落定
  const comp = running ? null : compressionPhase(t, compressionState);

  const idle = running ? null : idleLabel(t, messages);
  // 一行档失败镜像：运行中最后一步已失败，顶条镜像同一句红字动向，不带失败标记
  const liveFailed = liveRun
    ? !!liveRun.steps[liveRun.steps.length - 1]?.failed
    : false;
  const label = liveRun
    ? liveRunLabel(t, liveRun)
    : comp
    ? comp.label
    : idle?.text ?? t('live.thinking');
  const labelRed = liveRun
    ? liveFailed
    : comp
    ? comp.failed
    : idle?.failed ?? false;
  const PhaseIcon = liveRun ? phaseIcon(liveRun) : comp ? comp.icon : null;
  const idleFailed = idle?.failed ?? false;
  const barInteractive = mode !== 'hair';

  return (
    <Animated.View style={[styles.layer, layerStyle]}>
      <Animated.View style={[styles.shellWrap, shellStyle]}>
        {/* 条子背景层，纯白不透明底加下描边，iOS 与安卓同规格，随条子档淡入淡出，不参与点击 */}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.shellBg, barStyle]}
          pointerEvents="none"
        />
        {/* 发丝线层，胶囊热区只在 hair 档接管点击 */}
        <Animated.View
          style={[StyleSheet.absoluteFill, capsuleStyle]}
          pointerEvents={barInteractive ? 'none' : 'auto'}
        >
          <HairSeam
            label={t('live.restore')}
            running={running || !!comp?.dots}
            onRestore={() => applyMode('line')}
          />
        </Animated.View>
        {/* 条子内容层，一行档与展开面板，hair 档退出点击 */}
        <Animated.View
          style={barStyle}
          pointerEvents={barInteractive ? 'auto' : 'none'}
        >
          {/* 行档高 36 加下描边 1 共 37，ChatScreen 消息区顶部留位常量按此预留，两边调整需同步 */}
          <View style={styles.rowBar}>
            <Pressable
              style={({ pressed }) => [
                styles.rowMain,
                pressed && styles.pressed,
              ]}
              onPress={() => applyMode(mode === 'open' ? 'line' : 'open')}
              accessibilityRole="button"
              accessibilityState={{ expanded: mode === 'open' }}
            >
              {PhaseIcon ? (
                <PhaseIcon
                  size={11}
                  color={comp?.failed ? FAIL_RED : colors.primary}
                />
              ) : idleFailed ? null : (
                <CheckCircle size={16} color={colors.success} />
              )}
              <Text
                style={[
                  styles.rowLabel,
                  labelRed ? styles.rowLabelRed : styles.rowLabelNormal,
                ]}
                numberOfLines={1}
              >
                {label}
                {comp?.mono && (
                  <Text style={styles.monoNote}> {comp.mono}</Text>
                )}
              </Text>
              {/* 圆点紧跟动向文字右侧，文字超长先收缩截断，圆点保持在省略号之后 */}
              {(running && !liveFailed) || comp?.dots ? <Dots /> : null}
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.collapseBtn,
                pressed && styles.pressed,
              ]}
              onPress={() => applyMode('hair')}
              accessibilityRole="button"
              accessibilityLabel={t('live.collapse')}
            >
              <ChevronUp size={16} color={colors.textTertiary} />
            </Pressable>
          </View>
          <Animated.View style={[styles.panelClip, panelStyle]}>
            <FlatList
              inverted
              data={panelData}
              keyExtractor={(_, i) => `row-${i}`}
              renderItem={({ item }) => <TimelineRow row={item} />}
              style={{ height: cappedPanelH }}
              contentContainerStyle={styles.panelListContent}
              onContentSizeChange={(_w, h) => {
                logger.debug(`[LiveStrip] panel content height ${h}`);
                setPanelContentH(h);
              }}
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 0,
              }}
              initialNumToRender={12}
              showsVerticalScrollIndicator={false}
            />
            {mode === 'open' && rows.length > 0 && (
              // 列表底部渐隐，落在底部留白上方，最新行完整可见
              <View pointerEvents="none" style={styles.panelFade}>
                <Svg width="100%" height={20}>
                  <Defs>
                    <LinearGradient
                      id="livePanelFade"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <Stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                      <Stop offset="1" stopColor="#ffffff" stopOpacity="0.9" />
                    </LinearGradient>
                  </Defs>
                  <Rect
                    x="0"
                    y="0"
                    width="100%"
                    height="20"
                    fill="url(#livePanelFade)"
                  />
                </Svg>
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * 完全收起档的手柄胶囊，悬浮层不占布局，运行与空闲同长 64 乘 4 圆角 2 距 header 下缘 6px。
 * 运行态胶囊即轨道，淡蓝底内有一条渐变光带从左向右循环流动，周期 1.4s ease-in-out。
 * 空闲态同一胶囊换灰色静止，一眼是个能点的控件，两态不变尺寸。
 * 热区背景透明全宽二十像素，消息从胶囊下方滚过，点按恢复留一行。
 * @param label 无障碍标签
 * @param running 运行期标记，控制轨道颜色与光带
 * @param onRestore 点按恢复回调
 */
function HairSeam({
  label,
  running,
  onRestore,
}: {
  label: string;
  running: boolean;
  onRestore: () => void;
}) {
  const translateX = useSharedValue(-BAND_W);
  useEffect(() => {
    if (!running) {
      return;
    }
    translateX.value = -BAND_W;
    translateX.value = withRepeat(
      withTiming(CAPSULE_W, {
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
      }),
      -1
    );
    return () => {
      cancelAnimation(translateX);
    };
  }, [running, translateX]);
  const bandStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Pressable
      style={styles.hairHotZone}
      onPress={onRestore}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.capsule,
          { backgroundColor: running ? SEAM_TRACK : SEAM_IDLE },
        ]}
      >
        {running && (
          <Animated.View style={bandStyle}>
            <Svg width={BAND_W} height={HAIR_THICKNESS}>
              <Defs>
                <LinearGradient id="liveHairBand" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#007AFF" stopOpacity="0" />
                  <Stop offset="0.5" stopColor="#007AFF" stopOpacity="1" />
                  <Stop offset="1" stopColor="#007AFF" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect
                x="0"
                y="0"
                width={BAND_W}
                height={HAIR_THICKNESS}
                fill="url(#liveHairBand)"
              />
            </Svg>
          </Animated.View>
        )}
      </View>
    </Pressable>
  );
}

/** 工具行的行数据形状，供前置位组件收窄消费 */
type ToolRow = Extract<TimelineRowData, { kind: 'tool' }>;

/** 空压缩记录常量，避免选择器每次取值产生新引用引发多余渲染 */
const EMPTY_RECORDS: CompressionRecord[] = [];

/**
 * 时间线的压缩行，一次压缩一条记录随会话持久化，移动端纯展示不可点。
 * 运行与重试带呼吸圆点，重试附等宽序号，完成带前后对比，
 * 真底线与失败整句红字换 XCircle，中断灰字兜悬置运行态，前后数字缺失不出对比。
 * @param record 压缩记录
 */
function CompressionRow({ record }: { record: CompressionRecord }) {
  const { t } = useTranslation();
  const live = record.state === 'running';
  const retrying = live && record.attempt > 1;
  const floor = record.state === 'failed' && record.reason === 'no_material';
  const red = record.state === 'failed';
  const landed = record.state === 'complete';
  const label = live
    ? retrying
      ? t('live.compressionRetrying')
      : t('live.compressionRunning')
    : landed
    ? t('live.compressionCompacted')
    : floor
    ? t('live.compressionFloorEmpty')
    : record.state === 'failed'
    ? t('live.compressionFailed')
    : t('live.compressionUnfinished');
  const mono =
    record.before != null && record.after != null
      ? `${formatK(record.before)} → ${formatK(record.after)}`
      : null;
  return (
    <View style={styles.timelineRow}>
      {red ? (
        <XCircle size={14} color={FAIL_RED} />
      ) : (
        <Minimize2 size={14} color={live ? COMPRESS_BLUE : ROW_ICON} />
      )}
      <Text
        style={[
          styles.rowText,
          red
            ? styles.failText
            : live
            ? styles.liveText
            : styles.compressIdleText,
        ]}
        numberOfLines={2}
      >
        {label}
        {retrying && <Text style={styles.monoNote}> ({record.attempt}/3)</Text>}
        {landed && mono && <Text style={styles.monoNote}> {mono}</Text>}
      </Text>
      {live && <Dots style={styles.rowDots} />}
    </View>
  );
}

/** 工具行前置位，MCP 工具显所属服务 logo，经 CachedImage 走内容哈希缓存，图址缺失或加载失败回退身份图标 */
function ToolLeadingIcon({ row }: { row: ToolRow }) {
  const [logoFailed, setLogoFailed] = useState(false);
  if (row.iconUrl && !logoFailed) {
    return (
      <CachedImage
        source={row.iconUrl}
        style={styles.toolLogo}
        resizeMode="contain"
        onError={() => setLogoFailed(true)}
      />
    );
  }
  const Icon = toolIcon(row.tool);
  return <Icon size={14} color={ROW_ICON} />;
}

/**
 * 时间线的单行，五类各自可辨，行纯展示不可点。
 * 前置位任何时候都是身份图标，运行行的圆点紧跟文字右侧对齐首行，
 * 失败行整句红字紧跟 circle-x。
 * @param row 当前行数据
 */
function TimelineRow({ row }: { row: TimelineRowData }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const live =
    row.kind === 'user' || row.kind === 'note' || row.kind === 'compress'
      ? false
      : row.live ?? false;

  if (row.kind === 'user') {
    return (
      <View style={styles.timelineRow}>
        <MessageCircle size={14} color={ROW_ICON} />
        <Text style={[styles.rowText, styles.userText]} numberOfLines={2}>
          {row.text}
        </Text>
      </View>
    );
  }

  if (row.kind === 'think') {
    const text = row.synthetic ? t('live.thinking') : row.text;
    return (
      <View style={styles.timelineRow}>
        <Lightbulb size={14} color={ROW_ICON} />
        <Text
          style={[styles.rowText, live && styles.liveText]}
          numberOfLines={2}
        >
          {text}
        </Text>
        {live && <Dots style={styles.rowDots} />}
      </View>
    );
  }

  // 解说行与回复行共用一套文字行渲染，写作期标记行取固定文案与主色图标
  if (row.kind === 'note' || row.kind === 'reply') {
    const TextIcon = row.kind === 'note' ? MessageSquareDashed : MessageSquare;
    const text =
      row.kind === 'reply' && row.synthetic ? t('live.replying') : row.text;
    return (
      <View style={styles.timelineRow}>
        <TextIcon size={14} color={live ? colors.primary : ROW_ICON} />
        <Text
          style={[styles.rowText, live && styles.liveText]}
          numberOfLines={2}
        >
          {text}
        </Text>
        {live && <Dots style={styles.rowDots} />}
      </View>
    );
  }

  // 压缩行自带完整渲染，纯展示不可点
  if (row.kind === 'compress') {
    return <CompressionRow record={row.record} />;
  }

  const summary = stepPhrase(t, {
    tool: row.tool,
    detail: row.detail,
    toolTitle: row.toolTitle,
    startedAt: 0,
    endedAt: 1,
  });
  return (
    <View style={styles.timelineRow}>
      <ToolLeadingIcon row={row} />
      {row.failed ? (
        // 失败行主文字不撑满整行，标记贴着文字尾部
        <View style={styles.failRow}>
          <Text style={[styles.rowText, styles.failText]} numberOfLines={2}>
            {summary}
          </Text>
          <XCircle size={11} color={FAIL_RED} />
        </View>
      ) : (
        <Text
          style={[styles.rowText, live && styles.liveText]}
          numberOfLines={2}
        >
          {summary}
        </Text>
      )}
      {live && !row.failed && <Dots style={styles.rowDots} />}
    </View>
  );
}

const styles = StyleSheet.create({
  // 只锚顶不锚底，高度随内容自适应，条子以下的区域不挡消息列表的触摸
  // 层级 10 让先绘制的条子压过后绘制的聊天列表，同时保持在 FIB 输入浮层层级 20 之下
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  shellWrap: {
    overflow: 'hidden',
  },
  // 纯白不透明底加下描边，聊天文字不透出，iOS 与安卓统一规格
  shellBg: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  rowBar: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  collapseBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  pressed: {
    backgroundColor: '#f2f2f7',
  },
  rowLabel: {
    // 自然宽度不撑满整行，圆点紧跟文字右侧，空间不足先收缩截断
    flexShrink: 1,
    ...typography.caption,
  },
  rowLabelNormal: {
    fontWeight: '500',
    color: '#333333',
  },
  rowLabelRed: {
    fontWeight: '600',
    color: FAIL_RED,
  },
  panelClip: {
    overflow: 'hidden',
    position: 'relative',
  },
  panelListContent: {
    // 倒置列表里 paddingTop 映射视觉底，最新行停在渐隐留白上方不被压住
    paddingTop: 20,
    paddingBottom: 4,
  },
  panelFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 20,
  },
  hairHotZone: {
    height: 20,
    width: '100%',
  },
  capsule: {
    marginTop: 6,
    alignSelf: 'center',
    width: CAPSULE_W,
    height: HAIR_THICKNESS,
    borderRadius: 2,
    overflow: 'hidden',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  rowText: {
    // 自然宽度不撑满整行，活动行圆点与失败行叉号紧跟文字尾部
    flexShrink: 1,
    ...typography.caption,
  },
  userText: {
    flex: 1,
    color: ROW_ICON,
  },
  toolLogo: {
    width: 14,
    height: 14,
    marginTop: 1,
  },
  liveText: {
    fontWeight: '500',
    color: '#333333',
  },
  compressIdleText: {
    color: ROW_ICON,
  },
  monoNote: {
    fontVariant: ['tabular-nums'],
  },
  failText: {
    color: FAIL_RED,
  },
  failRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 2,
    alignItems: 'center',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#007AFF',
  },
  rowDots: {
    marginTop: 6,
  },
});
