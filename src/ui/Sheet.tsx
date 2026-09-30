import type {ReactNode} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {radius, size, space, useLayout, useTheme} from '@/src/design';

import {Button} from './Button';
import {Text} from './Text';

/**
 * The sheet shell shared by Edit charts and Rules: a bottom sheet on the phone,
 * a right-side sheet on desktop, a title with Done, and a scrolling body. The
 * sheet shrinks above the keyboard so fields low in the body stay reachable.
 */
export function Sheet({
  visible,
  title,
  onClose,
  header,
  children,
  bodyStyle,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Fixed lines between the title and the scrolling body. */
  header?: ReactNode;
  children: ReactNode;
  bodyStyle?: object;
}) {
  const {color} = useTheme();
  const layout = useLayout();
  return (
    <Modal
      visible={visible}
      transparent
      animationType='fade'
      onRequestClose={onClose}>
      <View style={[styles.scrim, {backgroundColor: color.scrim}]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView
          style={[styles.frame, layout.isDesktop ? styles.frameSide : null]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          pointerEvents='box-none'>
          <View
            style={[
              styles.sheet,
              layout.isDesktop ? styles.side : styles.bottom,
              {backgroundColor: color.surfaceOverlay},
            ]}>
            <View style={styles.header}>
              <Text variant='title' style={styles.flex}>
                {title}
              </Text>
              <Button label='Done' onPress={onClose} />
            </View>
            {header}
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.body, bodyStyle]}
              keyboardShouldPersistTaps='handled'>
              {children}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {flex: 1},
  frame: {flex: 1, justifyContent: 'flex-end'},
  frameSide: {flexDirection: 'row'},
  // overflow hidden + a flexing ScrollView keep a long body inside the sheet.
  sheet: {padding: space.xl, gap: space.md, overflow: 'hidden'},
  bottom: {
    flex: 1,
    marginTop: size.sheetTop,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  side: {width: size.sheetSideWidth},
  scroll: {flex: 1},
  header: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  flex: {flex: 1},
  body: {paddingBottom: space.xxxl},
});
