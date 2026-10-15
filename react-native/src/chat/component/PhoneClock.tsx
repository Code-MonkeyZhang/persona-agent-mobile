/**
 * @file PhoneClock.tsx
 * @description 桌面时钟与日期。刷新粒度取 15 秒，分钟跳变足够且省电，
 *   英文日期行走系统本地化，中文星期名手排，安卓的精简 ICU 不带中文 locale 数据，
 *   文字颜色随壁纸深浅切换，安卓数字字体不支持等宽数字，接受轻微宽度抖动。
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

/** 中文星期名，安卓精简 ICU 缺中文 locale 数据，中文行手排保底 */
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'];

const PhoneClock: React.FC<{ dark: boolean }> = ({ dark }) => {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const zh = i18n.language.startsWith('zh');
  const date = zh
    ? `${now.getMonth() + 1}月${now.getDate()}日 星期${WEEK_ZH[now.getDay()]}`
    : now.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      });
  const fg = dark ? '#ffffff' : '#16202e';

  return (
    <>
      <Text style={[styles.time, dark && styles.timeShadow, { color: fg }]}>
        {hh}:{mm}
      </Text>
      <Text style={[styles.date, styles.dateDim, { color: fg }]}>{date}</Text>
    </>
  );
};

const styles = StyleSheet.create({
  time: {
    fontSize: 48,
    fontWeight: '200',
    letterSpacing: 2,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  timeShadow: {
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  date: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  dateDim: {
    opacity: 0.8,
  },
});

export default PhoneClock;
