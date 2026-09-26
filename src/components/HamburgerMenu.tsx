import React, {useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Dimensions,
  Animated,
  Easing,
} from 'react-native';
import {useRouter} from 'expo-router';
import {RacingTheme} from '@src/theme';

const {width} = Dimensions.get('window');

interface MenuItem {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}

interface HamburgerMenuProps {
  currentScreen?: string;
}

const HamburgerMenu: React.FC<HamburgerMenuProps> = ({currentScreen}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [slideAnim] = useState(new Animated.Value(-width));
  const router = useRouter();

  const toggleMenu = () => {
    if (isVisible) {
      // Close menu
      Animated.timing(slideAnim, {
        toValue: -width,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setIsVisible(false));
    } else {
      // Open menu
      setIsVisible(true);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  };

  const closeMenu = () => {
    Animated.timing(slideAnim, {
      toValue: -width,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setIsVisible(false));
  };

  const menuItems: MenuItem[] = [
    {
      id: 'driver',
      label: 'Driver Profile',
      icon: '🏁',
      action: () => {
        closeMenu();
        router.push('/driver-profile');
      },
    },
    {
      id: 'index',
      label: 'Lap Analysis',
      icon: '📊',
      action: () => {
        closeMenu();
        router.push('/');
      },
    },
    {
      id: 'cache',
      label: 'Cache Management',
      icon: '💾',
      action: () => {
        closeMenu();
        router.push('/cache-management');
      },
    },
  ];

  return (
    <>
      {/* Hamburger Button */}
      <TouchableOpacity
        style={styles.hamburgerButton}
        onPress={toggleMenu}
        activeOpacity={0.7}>
        <View style={styles.hamburgerIcon}>
          <View style={styles.hamburgerLine} />
          <View style={styles.hamburgerLine} />
          <View style={styles.hamburgerLine} />
        </View>
      </TouchableOpacity>

      {/* Overlay */}
      {isVisible && (
        <Modal
          visible={isVisible}
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
                {
                  transform: [{translateX: slideAnim}],
                },
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
                {menuItems.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.menuItem,
                      currentScreen === item.id && styles.activeMenuItem,
                    ]}
                    onPress={item.action}
                    activeOpacity={0.7}>
                    <Text style={styles.menuIcon}>{item.icon}</Text>
                    <Text
                      style={[
                        styles.menuLabel,
                        currentScreen === item.id && styles.activeMenuLabel,
                      ]}>
                      {item.label}
                    </Text>
                    {currentScreen === item.id && (
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
  hamburgerButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: RacingTheme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1000,
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  menuContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: width * 0.8,
    height: '100%',
    backgroundColor: RacingTheme.colors.surface,
    shadowColor: '#000',
    shadowOffset: {
      width: 2,
      height: 0,
    },
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
    flex: 1,
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

export default HamburgerMenu;
