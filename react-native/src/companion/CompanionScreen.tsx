/**
 * @file CompanionScreen.tsx
 * @description Agent 陪伴模式全屏页面。
 *   叠加布局：白底兜底 → 背景图 → 立绘图 → UI 控件。
 *   无资源 Agent 显示提示文案。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ChevronLeft } from 'lucide-react-native';
import type { RouteParamList } from '../types/RouteTypes.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import {
  fetchPoses,
  getBackgroundImageUrl,
  getPoseImageUrl,
} from '../api/server-api.ts';

type Props = NativeStackScreenProps<RouteParamList, 'Companion'>;

function CompanionScreen({ navigation, route }: Props): React.JSX.Element {
  const agentId = route.params.agentId;
  const serverAddr = getServerAddress();

  /** 页面挂载时间戳，用于计算各资源加载耗时（性能日志） */
  const mountTime = useRef(Date.now());

  /**
   * Agent 是否拥有陪伴资源（三态）：
   *   null  → 加载中（尚未收到 fetchPoses 响应）
   *   true  → 有 pose 图片，展示背景 + 立绘
   *   false → 无资源或请求失败，显示"未配置陪伴形象"提示
   */
  const [hasAssets, setHasAssets] = useState<boolean | null>(null);

  /** 背景图加载失败时隐藏该层，露出灰色兜底层 */
  const [bgError, setBgError] = useState(false);

  /** 立绘图加载失败时隐藏该层，避免显示破损图片占位 */
  const [poseError, setPoseError] = useState(false);

  /**
   * 页面挂载时请求 Agent 的 pose 列表，判断是否有陪伴资源。
   * 使用 cancelled 标志防止组件卸载后的异步回调执行 setState（避免内存泄漏警告）。
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

  // 当前展示的姿态名称，硬编码为 'default'（Step 4 将实现通过 WebSocket 动态切换）
  const currentPose = 'default';

  // 4 层叠加布局：灰色兜底 → 背景图 → 立绘图 → UI 控件
  return (
    <View style={styles.container}>
      {/* 第 2 层：背景图片（absoluteFill 铺满全屏，cover 模式裁切） */}
      {!bgError && hasAssets === true && (
        <Image
          source={{ uri: getBackgroundImageUrl(agentId, serverAddr) }}
          style={styles.background}
          onLoad={() => {
            console.log(
              `[Companion] background loaded in ${
                Date.now() - mountTime.current
              }ms`
            );
          }}
          onError={() => {
            console.log('[Companion] background load failed');
            setBgError(true);
          }}
          resizeMode="cover"
        />
      )}

      {/* 第 3 层：立绘图（底部对齐，高度 85%，contain 模式保持比例） */}
      {hasAssets === true && !poseError && (
        <Image
          source={{ uri: getPoseImageUrl(agentId, currentPose, serverAddr) }}
          style={styles.pose}
          onLoad={() => {
            console.log(
              `[Companion] pose loaded in ${Date.now() - mountTime.current}ms`
            );
          }}
          onError={() => {
            console.log('[Companion] pose load failed');
            setPoseError(true);
          }}
          resizeMode="contain"
        />
      )}

      {/* 第 4 层：UI 控件（返回按钮、提示文案等），absoluteFill 浮于所有图片之上 */}
      <View style={styles.uiLayer}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <ChevronLeft size={22} color="#333" />
        </TouchableOpacity>

        {hasAssets === false && (
          <View style={styles.centerContent}>
            <Text style={styles.noAssetTitle}>该 Agent 还未配置陪伴形象</Text>
            <Text style={styles.noAssetHint}>
              在 assets/pose/ 目录下添加表情图片即可启用
            </Text>
          </View>
        )}
      </View>
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    marginTop: 56,
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
});

export default CompanionScreen;
