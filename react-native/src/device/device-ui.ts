/**
 * @file device/device-ui.ts
 * @description 设备界面的共享裁决逻辑。
 *   行状态按定稿映射，当前设备直映连接状态机，非当前一律绿点可连接。
 *   显示名兜底也在此共用。
 */
import type { ColorScheme } from '../theme/index.ts';
import type { ConnectionStatus } from '../stores/connectionStore.ts';
import type { DeviceEntry } from '../storage/StorageUtils.ts';

/** 状态点三色，绿已连接或可连接、蓝连接中、红连不上 */
export type DeviceDotColor = 'green' | 'blue' | 'red';

/** 行状态裁决结果，点的颜色、文案键与是否脉动 */
export interface DeviceRowStatus {
  color: DeviceDotColor;
  textKey: string;
  pulse: boolean;
}

/**
 * 行状态裁决。
 * 当前设备直映连接状态机，绿已连接、蓝脉动连接中、其余一律红失败；非当前一律绿点可连接。
 */
export function deviceRowStatus(
  isCurrent: boolean,
  status: ConnectionStatus
): DeviceRowStatus {
  if (!isCurrent) {
    return { color: 'green', textKey: 'device.statusAvailable', pulse: false };
  }
  if (status === 'connected') {
    return { color: 'green', textKey: 'device.statusConnected', pulse: false };
  }
  if (status === 'connecting' || status === 'reconnecting') {
    return { color: 'blue', textKey: 'device.statusConnecting', pulse: true };
  }
  return { color: 'red', textKey: 'device.statusFailed', pulse: false };
}

/** 状态点三色到主题色的映射，管理页与详情页共用 */
export function deviceDotColors(
  colors: ColorScheme
): Record<DeviceDotColor, string> {
  return {
    green: colors.success,
    blue: colors.primary,
    red: colors.error,
  };
}

/** 条目显示名，本地标签优先，没有用 hostId 兜底 */
export function deviceDisplayName(device: DeviceEntry): string {
  return device.name || device.hostId;
}
