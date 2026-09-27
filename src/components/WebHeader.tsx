import {RacingTheme} from '@src/theme';
import {usePathname, useRouter} from 'expo-router';
import React, {useState} from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const {width} = Dimensions.get('window');

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Racing Analytics',
  '/session-analysis': 'Session Analysis',
  '/multi-lap-comparison': 'Multi-Lap Comparison',
  '/cache-management': 'Cache Management',
};

const ROUTE_TO_SCREEN_ID: Record<string, string> = {
  '/': 'index',
  '/session-analysis': 'index',
  '/multi-lap-comparison': 'index',
  '/cache-management': 'cache',
};

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  path: string;
}

const MENU_ITEMS: MenuItem[] = [
  {id: 'index', label: 'Lap Analysis', icon: '🏁', path: '/'},
  {id: 'cache', label: 'Cache Manager', icon: '💾', path: '/cache-management'},
];

const WebHeader: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const [menuVisible, setMenuVisible] = useState(false);
  const [slideAnim] = useState(new Animated.Value(-width));

  const title = ROUTE_TITLES[pathname] ?? 'Lap Analysis';
  const currentId = ROUTE_TO_SCREEN_ID[pathname] ?? 'index';

  const openMenu = () => {
    setMenuVisible(true);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const closeMenu = () => {
    Animated.timing(slideAnim, {
      toValue: -width,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setMenuVisible(false));
  };

  const handleMenuAction = (path: string) => {
    closeMenu();
    router.push(path as any);
  };

  return (
    <>
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.hamburgerButton}
          onPress={openMenu}
          activeOpacity={0.7}>
          <View style={styles.hamburgerIcon}>
            <View style={styles.hamburgerLine} />
            <View style={styles.hamburgerLine} />
            <View style={styles.hamburgerLine} />
          </View>
        </TouchableOpacity>
        {Platform.OS === 'web' && (
          <Image
            source={{uri: '/favicon.png'}}
            style={styles.headerLogo}
            resizeMode='contain'
            accessibilityLabel='Lap Analysis logo'
          />
        )}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {menuVisible && (
        <Modal
          visible={menuVisible}
          transparent
          animationType='none'
          onRequestClose={closeMenu}>
          <TouchableOpacity
            style={styles.overlay}
            activeOpacity={1}
            onPress={closeMenu}>
            <Animated.View
              style={[
                styles.menuContainer,
                {transform: [{translateX: slideAnim}]},
              ]}>
              <View style={styles.menuHeader}>
                <Text style={styles.menuTitle}>Menu</Text>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={closeMenu}>
                  <Text style={styles.closeIcon}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.menuItems}>
                {MENU_ITEMS.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.menuItem,
                      currentId === item.id && styles.activeMenuItem,
                    ]}
                    onPress={() => handleMenuAction(item.path)}
                    activeOpacity={0.7}>
                    <Text style={styles.menuIcon}>{item.icon}</Text>
                    <Text
                      style={[
                        styles.menuLabel,
                        currentId === item.id && styles.activeMenuLabel,
                      ]}>
                      {item.label}
                    </Text>
                    {currentId === item.id && (
                      <View style={styles.activeIndicator} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.menuFooter}>
                <Text style={styles.versionText}>Lap Analysis v1.0</Text>
              </View>
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 8,
    backgroundColor: RacingTheme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: RacingTheme.colors.surfaceElevated,
    zIndex: 100,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  hamburgerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  headerLogo: {
    width: 40,
    height: 40,
    marginRight: 12,
  },
  hamburgerIcon: {
    width: 20,
    height: 14,
    justifyContent: 'space-between',
  },
  hamburgerLine: {
    width: '100%',
    height: 2,
    backgroundColor: RacingTheme.colors.text,
    borderRadius: 1,
  },
  title: {
    flex: 1,
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    letterSpacing: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  menuContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: width * 0.25,
    height: '100%',
    backgroundColor: RacingTheme.colors.surface,
    shadowColor: '#000',
    shadowOffset: {width: 2, height: 0},
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  menuHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: RacingTheme.colors.surfaceElevated,
  },
  menuTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: RacingTheme.colors.text,
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: RacingTheme.colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    fontSize: 16,
    color: RacingTheme.colors.text,
    fontWeight: 'bold',
  },
  menuItems: {
    paddingVertical: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: RacingTheme.colors.surfaceElevated,
  },
  activeMenuItem: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  menuIcon: {
    fontSize: 24,
    width: 30,
    textAlign: 'center',
    marginRight: 15,
  },
  menuLabel: {
    fontSize: 16,
    color: RacingTheme.colors.text,
    flex: 1,
  },
  activeMenuLabel: {
    color: RacingTheme.colors.primary,
    fontWeight: '600',
  },
  activeIndicator: {
    width: 4,
    height: 20,
    backgroundColor: RacingTheme.colors.primary,
    borderRadius: 2,
  },
  menuFooter: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: RacingTheme.colors.surfaceElevated,
  },
  versionText: {
    fontSize: 12,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center',
  },
});

export default WebHeader;
