import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Dialog from 'react-native-dialog';
import RNFS from 'react-native-fs';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { setHapticFeedbackEnabled, trigger } from '../chat/util/HapticUtils.ts';
import { HapticFeedbackTypes } from 'react-native-haptic-feedback/src';
import {
  getAllModels,
  getHapticEnabled,
  getTextModel,
  saveAllModels,
  saveTextModel,
  updateTextModelUsageOrder,
  generateOpenAICompatModels,
  getOpenAICompatConfigs,
  clearAllChatHistory,
} from '../storage/StorageUtils.ts';
import { CustomHeaderRightButton } from '../chat/component/CustomHeaderRightButton.tsx';
import { RouteParamList } from '../types/RouteTypes.ts';
import {
  DropdownItem,
  Model,
  OpenAICompatConfig,
} from '../types/Chat.ts';

import { isMac } from '../App.tsx';
import CustomDropdown from './DropdownComponent.tsx';
import CustomTextInput from './CustomTextInput.tsx';
import { useAppContext } from '../history/AppProvider.tsx';
import { useTheme, ColorScheme } from '../theme';
import OpenAICompatConfigsSection from './OpenAICompatConfigsSection.tsx';

function SettingsScreen(): React.JSX.Element {
  const { colors, isDark } = useTheme();
  const allModel = getAllModels();
  const [openAICompatConfigs, setOpenAICompatConfigs] = useState<
    OpenAICompatConfig[]
  >(getOpenAICompatConfigs);
  const [hapticEnabled, setHapticEnabled] = useState(getHapticEnabled);
  const navigation = useNavigation<NavigationProp<RouteParamList>>();
  const [textModels, setTextModels] = useState<Model[]>(allModel.textModel);
  const [selectedTextModel, setSelectedTextModel] =
    useState<Model>(getTextModel);
  const { sendEvent } = useAppContext();
  const sendEventRef = useRef(sendEvent);
  const openAICompatConfigsRef = useRef(openAICompatConfigs);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [clearCountdown, setClearCountdown] = useState(10);
  const [isClearing, setIsClearing] = useState(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleOpenAICompatConfigsChange = useCallback(
    (configs: OpenAICompatConfig[]) => {
      setOpenAICompatConfigs(configs);
    },
    []
  );

  const fetchAndSetModelNames = useCallback(() => {
    const openAICompatModelList = generateOpenAICompatModels(
      openAICompatConfigsRef.current
    );
    setTextModels(openAICompatModelList);

    if (openAICompatModelList.length > 0) {
      const textModel = getTextModel();
      const targetModel = openAICompatModelList.find(
        model => model.modelId === textModel.modelId
      );
      if (targetModel) {
        setSelectedTextModel(targetModel);
        saveTextModel(targetModel);
        updateTextModelUsageOrder(targetModel);
      } else {
        setSelectedTextModel(openAICompatModelList[0]);
        saveTextModel(openAICompatModelList[0]);
        updateTextModelUsageOrder(openAICompatModelList[0]);
      }
    }

    sendEventRef.current('modelChanged');
    if (openAICompatModelList.length > 0) {
      saveAllModels({ textModel: openAICompatModelList });
    }
  }, []);

  const fetchAndSetModelNamesRef = useRef(fetchAndSetModelNames);

  useEffect(() => {
    return navigation.addListener('focus', () => {
      fetchAndSetModelNamesRef.current();
    });
  }, [navigation]);

  const toggleHapticFeedback = (value: boolean) => {
    setHapticEnabled(value);
    setHapticFeedbackEnabled(value);
    if (value && Platform.OS === 'android') {
      trigger(HapticFeedbackTypes.impactMedium);
    }
  };

  useEffect(() => {
    const currentConfigs = openAICompatConfigsRef.current;
    if (
      JSON.stringify(openAICompatConfigs) === JSON.stringify(currentConfigs)
    ) {
      return;
    }
    openAICompatConfigsRef.current = openAICompatConfigs;
    fetchAndSetModelNamesRef.current();
  }, [openAICompatConfigs]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <CustomHeaderRightButton
          onPress={async () => {
            navigation.navigate('Bedrock', {
              sessionId: -1,
              tapIndex: -1,
            });
          }}
          imageSource={
            isDark
              ? require('../assets/done_dark.png')
              : require('../assets/done.png')
          }
        />
      ),
    });
  }, [navigation, isDark]);

  const textModelsData: DropdownItem[] = textModels.map(model => ({
    label: model.modelName ?? '',
    value: model.modelName ?? '',
  }));

  const handleOpenClearDialog = () => {
    setShowClearDialog(true);
    setClearCountdown(10);
    countdownIntervalRef.current = setInterval(() => {
      setClearCountdown(prev => {
        if (prev <= 1) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCloseClearDialog = () => {
    setShowClearDialog(false);
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setClearCountdown(10);
  };

  const handleClearAllData = async () => {
    if (clearCountdown > 0) {
      return;
    }
    setIsClearing(true);
    try {
      clearAllChatHistory();

      const documentPath = RNFS.DocumentDirectoryPath;
      const files = await RNFS.readDir(documentPath);
      for (const file of files) {
        if (
          file.name.startsWith('.') ||
          file.name === 'mmkv' ||
          file.name === 'RCTAsyncLocalStorage' ||
          file.name === 'RCTAsyncLocalStorage_V1'
        ) {
          continue;
        }
        try {
          if (file.isDirectory()) {
            await RNFS.unlink(file.path);
          } else {
            await RNFS.unlink(file.path);
          }
        } catch (e) {
          console.warn('Failed to delete file:', file.path, e);
        }
      }

      sendEvent('historyChanged');
      handleCloseClearDialog();
    } catch (error) {
      console.error('Error clearing data:', error);
    } finally {
      setIsClearing(false);
    }
  };

  const styles = createStyles(colors);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container}>
        <OpenAICompatConfigsSection
          isDark={isDark}
          onConfigsChange={handleOpenAICompatConfigsChange}
        />

        <Text style={[styles.label, styles.middleLabel]}>Select Model</Text>
        <CustomDropdown
          label="Chat Model"
          data={textModelsData}
          value={selectedTextModel.modelName}
          onChange={(item: DropdownItem) => {
            if (item.value !== '') {
              const selectedModel = textModels.find(
                model => model.modelName === item.value
              );
              if (selectedModel) {
                saveTextModel(selectedModel);
                setSelectedTextModel(selectedModel!);
                updateTextModelUsageOrder(selectedModel);
                sendEvent('modelChanged');
              }
            }
          }}
          placeholder="Select a model"
        />

        {!isMac && (
          <View style={styles.switchContainer}>
            <Text style={styles.label}>Haptic Feedback</Text>
            <Switch
              value={hapticEnabled}
              onValueChange={toggleHapticFeedback}
            />
          </View>
        )}
        <TouchableOpacity
          style={styles.clearDataButton}
          activeOpacity={0.7}
          onPress={handleOpenClearDialog}>
          <Text style={styles.clearDataButtonText}>Clear All Chat History</Text>
        </TouchableOpacity>
      </ScrollView>
      <Dialog.Container visible={showClearDialog}>
        <Dialog.Title>Clear All Data</Dialog.Title>
        <Dialog.Description>
          This will delete all chat history and saved files. This action cannot
          be undone.
          {clearCountdown > 0
            ? `\n\nPlease wait ${clearCountdown} seconds to confirm.`
            : '\n\nYou can now confirm the deletion.'}
        </Dialog.Description>
        <Dialog.Button label="Cancel" onPress={handleCloseClearDialog} />
        <Dialog.Button
          label={isClearing ? 'Clearing...' : 'Confirm'}
          onPress={handleClearAllData}
          disabled={clearCountdown > 0 || isClearing}
          color={clearCountdown > 0 ? '#999' : '#FF3B30'}
        />
      </Dialog.Container>
    </SafeAreaView>
  );
}

const createStyles = (colors: ColorScheme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      padding: 20,
    },
    label: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.text,
    },
    firstLabel: {
      marginBottom: 12,
    },
    middleLabel: {
      marginTop: 10,
      marginBottom: 12,
    },
    proxyLabel: {
      fontSize: 14,
      fontWeight: '400',
      color: colors.textDarkGray,
      marginLeft: 2,
    },
    text: {
      fontSize: 14,
      fontWeight: '400',
      color: colors.textSecondary,
    },
    input: {
      height: 40,
      borderColor: colors.inputBorder,
      borderWidth: 1,
      borderRadius: 6,
      marginBottom: 16,
      marginTop: 8,
      paddingHorizontal: 10,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    switchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: 10,
    },
    itemContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: 10,
    },
    arrowContainer: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    arrowImage: {
      width: 16,
      height: 16,
      transform: [{ scaleX: -1 }],
      opacity: 0.6,
      marginLeft: 4,
    },
    versionContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginVertical: 10,
      paddingBottom: 60,
    },
    clearDataButton: {
      backgroundColor: '#F5F5F5',
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 20,
      marginBottom: 80,
    },
    clearDataButtonText: {
      color: '#FF3B30',
      fontSize: 16,
      fontWeight: '600',
    },
    apiKeyContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    apiKeyInputContainer: {
      flex: 1,
      marginRight: 10,
    },
    proxyContainer: {
      marginBottom: 12,
    },
    proxyMacContainer: {
      marginTop: 10,
    },
    switch: {
      marginRight: -14,
      width: 32,
      height: 32,
    },
  });

export default SettingsScreen;
