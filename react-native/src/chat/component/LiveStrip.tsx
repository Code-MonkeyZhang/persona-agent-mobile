/**
 * @file LiveStrip.tsx
 * @description 会话时间线的行语言底座与顶栏时间线组件。
 *   - 行语言在手机端只此一处定义，消息内思考过程与顶栏时间线都从这里取口径
 *   - summarize 系纯函数从 persona-agent dev 的 packages/shared/src/tool-summary.ts
 *     复制维护，掩码先于截断执行的顺序不能反，两处改动需同步，这是跨仓纪律
 *   - 本体无 Grep 与 WebSearch，映射键按工具实名登记，未登记工具回退文档图标
 *   - 时间线三档浮在消息区上方不占布局，消息区高度恒定，行数据从消息流加运行态推导不新增存储
 *   - 行纯展示不可点，详情弹层只在桌面端
 *   - 档位偏好经本地存储跨启动记忆，只记 line 与 hair 两态，中止的轮次不落盘，时间线上它没有发生过
 *   - 连接横幅在位时整层让位到横幅下方，横幅收走滑回顶部
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
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import BackdropBlur from '../../component/BackdropBlur.tsx';
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
  Pencil,
  Smile,
  TerminalSquare,
  Wrench,
  XCircle,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore, EMPTY_MESSAGES, BOT_ID } from '../../stores/chatStore';
import { BANNER_HEIGHT, useBannerPresence } from '../../home/ConnectionBanner';
import {
  getStripCollapsed,
  saveStripCollapsed,
} from '../../storage/StorageUtils';
import type { ChatMessage } from '../../types/Chat';
import type { Thought } from '../../types/Thought';
import { useTheme, typography } from '../../theme';

/** 时间线行与消息内面板共用的时间线规格色值，取自设计文档与桌面实现，不进主题 token */
export const ROW_ICON = '#8E8E93';
export const FAIL_RED = '#d5392e';

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

/** 工具名到行前置位身份图标的映射，内置工具全量登记，未登记的第三方工具回退扳手 */
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
 * MCP 工具的身份由 iconUrl 图址承担，这里只兜无图址的展示位
 * @param tool 工具实名
 */
export function toolIcon(tool: string): IconComponent {
  return TOOL_ICONS[tool] ?? Wrench;
}

/** 掩码替换用的固定星串，定长不泄露原始凭据长度 */
const MASK = '********';

/** 值形态的凭据正则清单，整段替换为固定星串 */
const SENSITIVE_VALUE_RES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgho_[A-Za-z0-9]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g,
];

/** 键值对形态的凭据正则，键保留值替换 */
const SENSITIVE_PAIR_RE =
  /(\b(?:token|password|api_key)\b["']?\s*[:=]\s*)(["']?)[^\s"',}]+\2/gi;

/**
 * 对文本里的凭据形态打码，值形态整段替换，键值对形态保留键只换值
 * @param text 待打码的原文
 */
function maskSensitive(text: string): string {
  let out = text;
  for (const re of SENSITIVE_VALUE_RES) {
    out = out.replace(re, MASK);
  }
  return out.replace(SENSITIVE_PAIR_RE, `$1$2${MASK}$2`);
}

/**
 * 文案截断，超上限裁到 max 减一并补省略号
 * @param text 原文
 * @param max 上限字符数
 */
function trunc(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * 路径取 basename，结尾斜杠剥掉后取最后一段
 * @param path 原始路径
 */
function baseName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path;
}

/**
 * 取网址的主机名并去掉开头的 www，解析失败回退原文
 * RN 的类型环境不带 WHATWG URL 全局，用正则承担同一职责
 * @param url 原始网址
 */
function hostnameFromUrl(url: string): string {
  const matched = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]+@)?([^/?#:]+)/i.exec(url);
  return matched ? matched[1].replace(/^www\./, '') : url;
}

/**
 * 把工具入参对象压成一句参数摘要，供时间线行动向句复用
 * 摘要只取关键参数字段，缺参返回空串由调用方走文案回退，掩码先于截断执行
 * @param toolName 工具实名
 * @param toolInput 解析后的入参对象
 */
export function summarizeToolInput(
  toolName: string,
  toolInput?: Record<string, unknown>
): string {
  if (!toolInput) return '';
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  let summary: string;
  switch (toolName) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      summary = str(toolInput.path);
      break;
    case 'bash':
      summary = str(toolInput.command);
      break;
    case 'bash_output':
    case 'bash_kill':
      summary = str(toolInput.bash_id);
      break;
    case 'web_fetch':
      summary = hostnameFromUrl(str(toolInput.url));
      break;
    case 'show_pose':
      summary = str(toolInput.pose);
      break;
    case 'get_current_pose':
      summary = '';
      break;
    default:
      summary = trunc(maskSensitive(JSON.stringify(toolInput)), 40);
      break;
  }
  return maskSensitive(summary);
}

/**
 * 单个步骤的自然语言动向句，三级取值链，模型自写短标题优先，
 * 查表翻译次之，未登记的第三方工具回退正在执行加工具名，截断口径只剩 Bash 24
 * @param t 文案函数
 * @param step 待叙述的步骤
 */
export function stepPhrase(t: Translate, step: LiveStep): string {
  if (step.toolTitle) return step.toolTitle;
  switch (step.tool) {
    case '':
      return t('live.thinking');
    case 'read_file':
      return step.detail
        ? `${t('live.read')} ${baseName(step.detail)}`
        : t('live.readFallback');
    case 'write_file':
      return step.detail
        ? `${t('live.write')} ${baseName(step.detail)}`
        : t('live.writeFallback');
    case 'edit_file':
      return step.detail
        ? `${t('live.edit')} ${baseName(step.detail)}`
        : t('live.editFallback');
    case 'bash':
      return step.detail
        ? `${t('live.bash')} ${trunc(step.detail, 24)}`
        : t('live.bashFallback');
    case 'bash_output':
      return t('live.bashOutput');
    case 'bash_kill':
      return t('live.bashKill');
    case 'web_fetch':
      return step.detail
        ? `${t('live.webfetch')} ${step.detail}`
        : t('live.webfetchFallback');
    case 'show_pose':
      return t('live.showPose');
    case 'get_current_pose':
      return t('live.getPose');
    default:
      return `${t('live.executing')} ${step.tool}`;
  }
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
 * 状态条当前动作文案推导，三态纯函数，有未闭合工具步则工具执行叙述，
 * 无活动步且正文写作中返回正在回复，其余思考中
 * @param t 文案函数
 * @param liveRun 当前回合的实时状态
 */
export function liveRunLabel(t: Translate, liveRun: LiveRunState): string {
  const active = [...liveRun.steps].reverse().find((s) => !s.endedAt);
  if (active) return stepPhrase(t, active);
  return liveRun.replying ? t('live.replying') : t('live.thinking');
}

/**
 * 顶条图标位随相位换身份图标，三态纯函数，活动工具步取工具身份，
 * 正文写作中取方形气泡，其余灯泡
 * @param liveRun 当前回合的实时状态
 */
export function phaseIcon(liveRun: LiveRunState): IconComponent {
  const active = [...liveRun.steps].reverse().find((s) => !s.endedAt);
  if (active && active.tool !== '') return toolIcon(active.tool);
  return liveRun.replying ? MessageSquare : Lightbulb;
}

/** 时间线行数据，kind 区分五类条目，live 标记运行期未闭合的活动行
 *  synthetic 标记思考间隙与写作期补出的活动行，文本渲染时取文案不存值
 *  note 是模型中间解说，reply 是回复内容 */
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
    };

/**
 * 把会话消息流摊平成时间线行，顺序即发生顺序。
 * GiftedChat 数组新在前，先倒序摊平还原时间正序。
 * 用户消息出用户行充当轮次锚点，助手消息的思考段出思考行，工具调用出工具行带参数摘要，
 * 落盘消息的中间解说轮末收起不进行，助手正文非空出回复内容行给整轮收尾。
 * 落盘行与运行行的失败判定同源，读 thought 的 isError 与 toolResult 的 isError。
 * 运行期 liveRun 的步骤作为活动尾巴接在末尾，当前轮的消息还没落盘由它补齐，
 * 文字步按后面跟不跟工具定性，跟了出中间解说行，没跟出回复内容行，
 * 运行中没有未闭合工具步时按相位补活动行，写作期补正在回复标记，间隙补思考中。
 * @param messages 当前会话消息流，新在前
 * @param liveRun 运行期实时状态，空闲或归属不符传 null
 */
export function buildRows(
  messages: ChatMessage[],
  liveRun: LiveRunState | null
): TimelineRowData[] {
  const rows: TimelineRowData[] = [];
  for (const m of [...messages].reverse()) {
    if (m.user._id === 1) {
      rows.push({ kind: 'user', text: m.text });
      continue;
    }
    for (const th of m.steps ?? []) {
      if (th.type === 'tool_use') {
        rows.push({
          kind: 'tool',
          tool: th.toolName ?? '',
          detail: summarizeToolInput(th.toolName ?? '', th.toolInput),
          toolTitle: th.toolTitle,
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
  return rows;
}

/** 展开区时间线的高度上限，超出内部滚动 */
const PANEL_MAX_H = 288;

/** 行档全高 36 加下描边 1，与消息区顶部留位常量互引 */
const BAR_H = 37;

/** 发丝线档热区全高，胶囊占顶上 6 加 4 */
const HAIR_ZONE_H = 20;

/** 空闲摘要回退不到工具步数时，用户消息行的截断上限 */
const USER_LABEL_MAX = 24;

/** 发丝线档胶囊宽 64 高 4 圆角 2，距 header 下缘 6px，热区全宽 20px */
const CAPSULE_W = 64;
const HAIR_THICKNESS = 4;
const BAND_W = Math.round(CAPSULE_W * 0.4);

/** 运行态胶囊轨道的淡蓝底与空闲态灰 */
const SEAM_TRACK = '#007AFF26';
const SEAM_IDLE = '#D1D1D6';

/**
 * 空闲态一行档摘要，从最新一条带工具步的助手消息现算步数与失败步数。
 * 成功轮优先显示模型写的本轮意图，取最后一个工具步的 toolIntent，未写走步数兜底。
 * 失败轮输出 doneFail 红字整句，意图置空走兜底，不落任何驻留字段。
 * GiftedChat 数组新在前，从头部向尾部扫。
 * 回退不到工具步数时取最新一条用户消息截断，无消息显示思考中。
 * @param t 文案函数
 * @param messages 当前会话消息流，新在前
 */
export function idleLabel(
  t: Translate,
  messages: ChatMessage[]
): { text: string; failed: boolean } {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.user._id !== BOT_ID || !m.steps?.length) continue;
    const tools = m.steps.filter((th) => th.type === 'tool_use');
    if (tools.length === 0) continue;
    const fails = tools.filter(
      (th) => th.isError || th.toolResult?.isError
    ).length;
    if (fails > 0) {
      return {
        text: t('live.doneFail', { count: tools.length, fails }),
        failed: true,
      };
    }
    const intent = tools[tools.length - 1]?.toolIntent;
    return intent
      ? { text: intent, failed: false }
      : { text: t('live.done', { count: tools.length }), failed: false };
  }
  const newest = messages[0];
  if (newest && newest.user._id === 1) {
    return { text: trunc(newest.text, USER_LABEL_MAX), failed: false };
  }
  return { text: t('live.thinking'), failed: false };
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

/** 运行指示的三颗呼吸圆点，紧跟文字右侧对齐首行，由宿主传间距与偏移 */
function Dots({ style }: { style?: StyleProp<ViewStyle> }) {
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
    () => buildRows(messages, running ? liveRun : null),
    [messages, running, liveRun]
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

  const idle = running ? null : idleLabel(t, messages);
  // 一行档失败镜像：运行中最后一步已失败，顶条镜像同一句红字动向，不带失败标记
  const liveFailed = liveRun
    ? !!liveRun.steps[liveRun.steps.length - 1]?.failed
    : false;
  const label = liveRun
    ? liveRunLabel(t, liveRun)
    : idle?.text ?? t('live.thinking');
  const labelRed = liveRun ? liveFailed : idle?.failed ?? false;
  const PhaseIcon = liveRun ? phaseIcon(liveRun) : null;
  const idleFailed = idle?.failed ?? false;
  const barInteractive = mode !== 'hair';

  return (
    <Animated.View style={[styles.layer, layerStyle]}>
      <Animated.View style={[styles.shellWrap, shellStyle]}>
        {/* 条子背景层，磨砂加白底加下描边，随条子档淡入淡出，不参与点击 */}
        <Animated.View
          style={[StyleSheet.absoluteFill, barStyle]}
          pointerEvents="none"
        >
          <BackdropBlur />
          <View style={styles.shellBg} />
        </Animated.View>
        {/* 发丝线层，胶囊热区只在 hair 档接管点击 */}
        <Animated.View
          style={[StyleSheet.absoluteFill, capsuleStyle]}
          pointerEvents={barInteractive ? 'none' : 'auto'}
        >
          <HairSeam
            label={t('live.restore')}
            running={running}
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
                <PhaseIcon size={11} color={colors.primary} />
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
              </Text>
              {/* 圆点紧跟动向文字右侧，文字超长先收缩截断，圆点保持在省略号之后 */}
              {running && !liveFailed && <Dots />}
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
              style={{
                height:
                  panelContentH > 0
                    ? Math.min(panelContentH, PANEL_MAX_H)
                    : PANEL_MAX_H,
              }}
              contentContainerStyle={styles.panelListContent}
              onContentSizeChange={(_w, h) => setPanelContentH(h)}
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

/** 工具行前置位，MCP 工具显所属服务 logo，图址缺失或加载失败回退身份图标 */
function ToolLeadingIcon({ row }: { row: ToolRow }) {
  const [logoFailed, setLogoFailed] = useState(false);
  if (row.iconUrl && !logoFailed) {
    return (
      <Image
        source={{ uri: row.iconUrl }}
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
    row.kind === 'user' || row.kind === 'note' ? false : row.live ?? false;

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
  // 白色七成透明底加下描边是设计规格值，与桌面 bg-background/80 backdrop-blur 同口径
  shellBg: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.7)',
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
