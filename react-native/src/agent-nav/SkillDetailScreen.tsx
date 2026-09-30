/**
 * @file SkillDetailScreen.tsx
 * @description 技能详情页，从技能列表行推入，消费 getSkill 的投影。
 *   头部卡放 logo 磁贴、显示名与作者，信息卡按显示名称、技能 ID、简介、作者的定序收进白底卡，
 *   显示名称缺省回退机器名，ID 行只在两者不一致时出现，
 *   内容卡用 markdown 渲染技能正文，通篇随页面滚动。
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, ColorScheme } from '../theme/index.ts';
import { RouteParamList } from '../types/RouteTypes.ts';
import { type SkillDetail, getSkill } from '../api/server-api.ts';
import { getServerAddress } from '../storage/StorageUtils.ts';
import { logger } from '../lib/logger';
import {
  DetailInfoRow,
  DocMarkdown,
  EntityLogo,
  GroupCard,
  GroupSection,
} from './component/NavDetailShared.tsx';
import { typography, monoFont } from '../theme/index.ts';

type Props = NativeStackScreenProps<RouteParamList, 'SkillDetail'>;

const SkillDetailScreen: React.FC<Props> = ({ route }) => {
  const { name } = route.params;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);

  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const address = getServerAddress();
    if (!address) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    logger.info(`[SkillDetail] load: ${name}`);
    getSkill(address, name)
      .then((detail) => {
        setSkill(detail);
        setLoadFailed(false);
      })
      .catch((e) => {
        logger.error(`[SkillDetail] load failed: ${name} ${e}`);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loadFailed || !skill) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t('detail.notFound')}</Text>
      </View>
    );
  }

  const displayName = skill.displayName ?? skill.name;
  const showId = Boolean(skill.displayName) && skill.displayName !== skill.name;

  return (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.content}
    >
      {/* 头部卡：logo 磁贴加显示名，作者跟随名称下方 */}
      <View style={styles.headerCard}>
        <EntityLogo src={skill.logoUrl} fallback={Sparkles} />
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>
            {displayName}
          </Text>
          {skill.author ? (
            <Text style={styles.headerAuthor}>@{skill.author}</Text>
          ) : null}
        </View>
      </View>

      {/* 信息段：定序为显示名称、技能 ID、简介、作者，ID 行仅在名称不一致时出现 */}
      <GroupSection title={t('detail.sectionBasic')}>
        <GroupCard>
          <DetailInfoRow label={t('detail.fieldDisplayName')} first>
            <Text style={styles.infoText}>{displayName}</Text>
          </DetailInfoRow>
          {showId ? (
            <DetailInfoRow label={t('detail.fieldSlug')}>
              <Text style={styles.slugText}>{skill.name}</Text>
            </DetailInfoRow>
          ) : null}
          {skill.description ? (
            <DetailInfoRow label={t('detail.fieldIntro')}>
              <Text style={styles.infoIntro}>{skill.description}</Text>
            </DetailInfoRow>
          ) : null}
          {skill.author ? (
            <DetailInfoRow label={t('detail.fieldAuthor')}>
              <Text style={styles.infoText}>@{skill.author}</Text>
            </DetailInfoRow>
          ) : null}
        </GroupCard>
      </GroupSection>

      {/* 内容段：markdown 渲染，缺正文给占位文案 */}
      <GroupSection title={t('detail.sectionContent')}>
        <GroupCard>
          {skill.content ? (
            <View style={styles.docContainer}>
              <DocMarkdown value={skill.content} />
            </View>
          ) : (
            <Text style={styles.hintText}>
              {t('detail.instructionsMissing')}
            </Text>
          )}
        </GroupCard>
      </GroupSection>
    </ScrollView>
  );
};

/** 技能详情页样式工厂 */
const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    scrollView: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    content: {
      padding: 16,
      paddingBottom: 40,
    },
    emptyText: {
      ...typography.body,
      color: colors.textTertiary,
    },
    headerCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderRadius: 16,
      backgroundColor: colors.card,
      marginBottom: 16,
    },
    headerText: {
      flex: 1,
      minWidth: 0,
    },
    headerName: {
      ...typography.titleBar,
      fontWeight: '600',
      color: colors.text,
    },
    headerAuthor: {
      marginTop: 2,
      ...typography.tertiary,
      color: colors.textTertiary,
    },
    infoText: {
      ...typography.content,
      color: colors.textDarkGray,
    },
    infoIntro: {
      ...typography.meta,
      color: colors.textDarkGray,
    },
    slugText: {
      ...typography.meta,
      color: colors.textDarkGray,
      fontFamily: monoFont,
    },
    hintText: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      ...typography.meta,
      color: colors.textTertiary,
    },
    docContainer: {
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
  });

export default SkillDetailScreen;
