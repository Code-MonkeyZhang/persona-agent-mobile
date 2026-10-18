/**
 * @file deviceRowStatus.test.ts
 * @description 行状态裁决的直测，覆盖当前设备直映连接状态机与非当前恒绿可连接。
 */
import { deviceRowStatus } from '../src/device/device-ui';

describe('设备行状态裁决', () => {
  it('当前设备直映连接状态机，在途为蓝并脉动', () => {
    expect(deviceRowStatus(true, 'connected')).toEqual({
      color: 'green',
      textKey: 'device.statusConnected',
      pulse: false,
    });
    expect(deviceRowStatus(true, 'connecting')).toEqual({
      color: 'blue',
      textKey: 'device.statusConnecting',
      pulse: true,
    });
    expect(deviceRowStatus(true, 'reconnecting')).toEqual({
      color: 'blue',
      textKey: 'device.statusConnecting',
      pulse: true,
    });
    expect(deviceRowStatus(true, 'address_invalid')).toEqual({
      color: 'red',
      textKey: 'device.statusFailed',
      pulse: false,
    });
    expect(deviceRowStatus(true, 'idle')).toEqual({
      color: 'red',
      textKey: 'device.statusFailed',
      pulse: false,
    });
  });

  it('非当前设备一律绿点可连接，不吃任何连接态', () => {
    expect(deviceRowStatus(false, 'connected')).toEqual({
      color: 'green',
      textKey: 'device.statusAvailable',
      pulse: false,
    });
    expect(deviceRowStatus(false, 'connecting').color).toBe('green');
    expect(deviceRowStatus(false, 'address_invalid').color).toBe('green');
    expect(deviceRowStatus(false, 'idle').color).toBe('green');
  });
});
