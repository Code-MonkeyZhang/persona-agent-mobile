/**
 * @file deviceRowStatus.test.ts
 * @description 行状态裁决的直测，覆盖四态判定与颜色文案映射。
 */
import {
  deviceDotStatus,
  deviceRowStatus,
  type DeviceRowContext,
} from '../src/device/device-ui';
import type { DeviceEntry } from '../src/storage/StorageUtils';

/** 造一台设备条目 */
const entry = (hostId: string): DeviceEntry => ({
  hostId,
  name: '',
  address: `https://${hostId}`,
  version: '1.13.0',
  lastConnectedAt: 0,
});

/** 造一份裁决上下文，缺省当前是 host-a 且链路已连上 */
const ctx = (over: Partial<DeviceRowContext> = {}): DeviceRowContext => ({
  currentHostId: 'host-a',
  pendingHostId: '',
  status: 'connected',
  probes: {},
  ...over,
});

describe('状态点四态判定', () => {
  it('切换目标一律连接中', () => {
    const dot = deviceDotStatus(
      entry('host-b'),
      ctx({ pendingHostId: 'host-b' })
    );
    expect(dot).toBe('connecting');
  });

  it('当前设备直映连接状态机', () => {
    const current = entry('host-a');
    expect(deviceDotStatus(current, ctx())).toBe('online');
    expect(deviceDotStatus(current, ctx({ status: 'connecting' }))).toBe(
      'connecting'
    );
    expect(deviceDotStatus(current, ctx({ status: 'reconnecting' }))).toBe(
      'connecting'
    );
    expect(deviceDotStatus(current, ctx({ status: 'address_invalid' }))).toBe(
      'offline'
    );
    expect(deviceDotStatus(current, ctx({ status: 'idle' }))).toBe('offline');
  });

  it('切换期间当前设备冻结为在线，旧链路未被触碰', () => {
    const current = entry('host-a');
    const switching = ctx({ pendingHostId: 'host-b', status: 'connecting' });
    expect(deviceDotStatus(current, switching)).toBe('online');
  });

  it('其余设备吃探测结论，没查过算不知道', () => {
    const other = entry('host-b');
    expect(deviceDotStatus(other, ctx({ probes: { 'host-b': true } }))).toBe(
      'online'
    );
    expect(deviceDotStatus(other, ctx({ probes: { 'host-b': false } }))).toBe(
      'offline'
    );
    expect(deviceDotStatus(other, ctx())).toBe('unknown');
  });
});

describe('状态点到行表现映射', () => {
  it('连接中蓝色脉动，未查灰色呼吸', () => {
    expect(deviceRowStatus('connecting', true)).toEqual({
      color: 'blue',
      textKey: 'device.statusConnecting',
      pulse: true,
    });
    expect(deviceRowStatus('unknown', false)).toEqual({
      color: 'grey',
      textKey: 'device.statusChecking',
      pulse: true,
    });
  });

  it('在线与连不上在当前行与其余行文案不同', () => {
    expect(deviceRowStatus('online', true).textKey).toBe(
      'device.statusConnected'
    );
    expect(deviceRowStatus('online', false).textKey).toBe(
      'device.statusAvailable'
    );
    expect(deviceRowStatus('offline', true).textKey).toBe(
      'device.statusFailed'
    );
    expect(deviceRowStatus('offline', false).textKey).toBe(
      'device.statusUnreachable'
    );
  });
});
