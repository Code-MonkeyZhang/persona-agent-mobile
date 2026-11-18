/**
 * @file NoticeToast.tsx
 * @description 应用内通知的胶囊渲染器，App 的 toastConfig 三类共用同一形态。
 *   - 白底卡面色配主题字色，浮出靠轻投影与细描边，安卓投影真机确认后再定
 *   - 底色恒定中性，严重度由前置图标表达，warn 琥珀三角，error 红圈叉，info 无图标
 */
import { Platform, StyleSheet, Text, View } from 'react-native';
import { CircleX, TriangleAlert } from 'lucide-react-native';
import { useTheme, typography } from '../theme/index.ts';

/** 通知类型，与 notify 入口的词表一致 */
export type NoticeKind = 'warn' | 'error' | 'info';

interface NoticeToastProps {
  /** 严重度类型，决定前置图标 */
  kind: NoticeKind;
  /** 已翻译的文案，由 toastConfig 从 text1 传入 */
  text?: string;
}

/** 应用内通知胶囊，长文案换行收在八成宽内，圆角与留白对齐输入浮层的浮出语言 */
export function NoticeToast({
  kind,
  text,
}: NoticeToastProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.capsule,
        { backgroundColor: colors.card, borderColor: colors.borderLight },
      ]}
    >
      {kind === 'warn' && <TriangleAlert size={16} color={colors.warning} />}
      {kind === 'error' && <CircleX size={16} color={colors.error} />}
      <Text style={[styles.text, { color: colors.text }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'center',
    maxWidth: '80%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOpacity: 0.12,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 3,
      },
    }),
  },
  text: {
    ...typography.body,
    flexShrink: 1,
  },
});
