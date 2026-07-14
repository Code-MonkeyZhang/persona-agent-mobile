import React, { useState, useCallback, useEffect } from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Check, Copy } from 'lucide-react-native';
import { useTheme } from '../../../theme';

interface CopyButtonProps {
  /** Function that returns the content to copy, or direct content string */
  content: string | (() => string);
}

const CopyButton: React.FC<CopyButtonProps> = React.memo(({ content }) => {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = typeof content === 'function' ? content() : content;
    Clipboard.setString(text);
    setCopied(true);
  }, [content]);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  return (
    <TouchableOpacity style={styles.copyButtonLayout} onPress={handleCopy}>
      {copied ? (
        <Check size={22} color={colors.textSecondary} />
      ) : (
        <Copy size={22} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  copyButtonLayout: {
    padding: 10,
    marginLeft: 'auto',
  },
});

export default CopyButton;
