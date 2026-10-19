/**
 * @file device/device-ui.ts
 * @description 设备界面的共享裁决逻辑。
 *   状态点回答这台设备现在能不能连上，当前设备直映连接状态机，
 *   切换目标显连接中，其余设备吃探测结论，没查过算不知道。
 *   显示名兜底也在此共用。
 */
import type { ColorScheme } from '../theme/index.ts';
import type { ConnectionStatus } from '../stores/connectionStore.ts';
import type { DeviceEntry } from '../storage/StorageUtils.ts';

/** 状态点四态，绿检查过能连上、红检查过连不上、蓝连接进行中、灰还不知道 */
export type DeviceDotStatus = 'online' | 'connecting' | 'offline' | 'unknown';

/** 状态点四色，绿在线或可连接、蓝连接中、红连不上、灰未查 */
export type DeviceDotColor = 'green' | 'blue' | 'red' | 'grey';

/** 行状态裁决结果，点的颜色、文案键与是否脉动 */
export interface DeviceRowStatus {
  color: DeviceDotColor;
  textKey: string;
  pulse: boolean;
}

/** 行状态裁决的上下文，谁是当前、谁在被切换、当前链路态与探测结论表 */
export interface DeviceRowContext {
  currentHostId: string;
  pendingHostId: string;
  status: ConnectionStatus;
  probes: Record<string, boolean>;
}

/**
 * 单台设备的状态点裁决。
 * 切换目标一律连接中；当前设备直映连接状态机，切换期间旧链路未动冻结为在线；
 * 其余设备吃探测结论，缺项还不知道。
 */
export function deviceDotStatus(
  device: DeviceEntry,
  ctx: DeviceRowContext
): DeviceDotStatus {
  if (device.hostId === ctx.pendingHostId) {
    return 'connecting';
  }
  if (device.hostId === ctx.currentHostId) {
    if (ctx.pendingHostId) {
      return 'online';
    }
    if (ctx.status === 'connected') {
      return 'online';
    }
    if (ctx.status === 'connecting' || ctx.status === 'reconnecting') {
      return 'connecting';
    }
    return 'offline';
  }
  const reachable = ctx.probes[device.hostId];
  return reachable === undefined ? 'unknown' : reachable ? 'online' : 'offline';
}

/**
 * 状态点到行表现的映射。
 * online 与 offline 在当前行与其余行文案不同，connecting 蓝色脉动，unknown 灰色呼吸。
 */
export function deviceRowStatus(
  dot: DeviceDotStatus,
  isCurrent: boolean
): DeviceRowStatus {
  if (dot === 'connecting') {
    return { color: 'blue', textKey: 'device.statusConnecting', pulse: true };
  }
  if (dot === 'unknown') {
    return { color: 'grey', textKey: 'device.statusChecking', pulse: true };
  }
  if (dot === 'online') {
    return {
      color: 'green',
      textKey: isCurrent ? 'device.statusConnected' : 'device.statusAvailable',
      pulse: false,
    };
  }
  return {
    color: 'red',
    textKey: isCurrent ? 'device.statusFailed' : 'device.statusUnreachable',
    pulse: false,
  };
}

/** 状态点四色到主题色的映射，管理页与详情页共用 */
export function deviceDotColors(
  colors: ColorScheme
): Record<DeviceDotColor, string> {
  return {
    green: colors.success,
    blue: colors.primary,
    red: colors.error,
    grey: colors.textTertiary,
  };
}

/** 条目显示名，本地标签优先，没有用 hostId 兜底 */
export function deviceDisplayName(device: DeviceEntry): string {
  return device.name || device.hostId;
}
