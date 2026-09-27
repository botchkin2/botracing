import {RacingTheme} from '@src/theme';
import {useRouter} from 'expo-router';
import React, {useMemo, useRef, useState} from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

const {height} = Dimensions.get('window');

interface NavigationItem {
  id: string;
  label: string;
  icon: string;
  route: string;
  currentScreen?: string;
}

interface BottomNavigationProps {
  currentScreen?: string;
}

const BottomNavigation: React.FC<BottomNavigationProps> = ({currentScreen}) => {
  const isWeb = Platform.OS === 'web';
  const insets = useSafeAreaInsets();
  const [isExpanded, setIsExpanded] = useState(false);
  const slideAnim = useRef(new Animated.Value(isWeb ? 0 : height)).current; // Web: visible; mobile: start off-screen below
  const router = useRouter();

  const navigationItems: NavigationItem[] = useMemo(
    () => [
      {
        id: 'index',
        label: 'Lap Analysis',
        icon: '🏁',
        route: '/',
      },
      {
        id: 'cache',
        label: 'Cache Manager',
        icon: '💾',
        route: '/cache-management',
      },
    ],
    [],
  );

  const toggleNavigation = () => {
    // Mobile: translateY 0 = panel visible at bottom, translateY height = panel hidden below screen
    const toValue = isExpanded ? height : 0;

    Animated.timing(slideAnim, {
      toValue,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    setIsExpanded(!isExpanded);
  };

  const handleNavigation = (item: NavigationItem) => {
    if (item.id === currentScreen) {
      // If we're already on this screen, just close the navigation
      toggleNavigation();
      return;
    }

    toggleNavigation();
    // Small delay to allow animation to complete
    setTimeout(() => {
      router.push(item.route as never);
    }, 150);
  };

  // Pan responder for swipe gestures
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Only respond to vertical swipes
        return Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dx) < 10;
      },
      onPanResponderRelease: (evt, gestureState) => {
        // If swiped up and navigation is collapsed, expand it
        if (gestureState.dy < -50 && !isExpanded) {
          toggleNavigation();
        }
        // If swiped down and navigation is expanded, collapse it
        else if (gestureState.dy > 50 && isExpanded) {
          toggleNavigation();
        }
      },
    }),
  ).current;

  if (isWeb) {
    // Web: use top header + hamburger menu instead of bottom nav
    return null;
  }

  // Mobile version: Collapsible navigation (respect bottom safe area / home indicator)
  const bottomInset = insets.bottom;
  return (
    <>
      {/* Always-visible tab bar: laps + menu */}
      <View
        style={[styles.mobileTabBar, {paddingBottom: bottomInset}]}
        {...panResponder.panHandlers}>
        <TouchableOpacity
          style={styles.mobileTabBarSignIn}
          onPress={() => {
            if (currentScreen !== 'index') {
              router.push('/' as never);
            }
          }}
          activeOpacity={0.9}>
          <Text style={styles.mobileTabBarSignInIcon}>🏁</Text>
          <Text style={styles.mobileTabBarSignInLabel}>Laps</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.mobileTabBarTouchable}
          onPress={toggleNavigation}
          activeOpacity={0.9}>
          <Text style={styles.mobileTabBarIcon}>{isExpanded ? '▼' : '▲'}</Text>
          <Text style={styles.mobileTabBarLabel}>
            {isExpanded ? 'Close' : 'Menu'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Full navigation panel (slides up from tab bar) */}
      <Animated.View
        style={[
          styles.navigationContainer,
          {paddingBottom: bottomInset, transform: [{translateY: slideAnim}]},
        ]}>
        {/* Header with toggle button */}
        <View style={styles.navigationHeader}>
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={toggleNavigation}
            activeOpacity={0.8}>
            <Text style={styles.toggleIcon}>{isExpanded ? '▼' : '▲'}</Text>
            <Text style={styles.toggleText}>
              {isExpanded ? 'Tap to hide' : 'Swipe up or tap'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Navigation Items */}
        <View style={styles.navigationItems}>
          {navigationItems.map(item => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.navigationItem,
                currentScreen === item.id && styles.activeNavigationItem,
              ]}
              onPress={() => handleNavigation(item)}
              activeOpacity={0.7}>
              <View style={styles.itemIconContainer}>
                <Text style={styles.itemIcon}>{item.icon}</Text>
                {currentScreen === item.id && (
                  <View style={styles.activeIndicator} />
                )}
              </View>
              <View style={styles.itemContent}>
                <Text
                  style={[
                    styles.itemLabel,
                    currentScreen === item.id && styles.activeItemLabel,
                  ]}>
                  {item.label}
                </Text>
                {currentScreen === item.id && (
                  <Text style={styles.currentScreenText}>Current</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.navigationFooter}>
          <Text style={styles.footerText}>
            {isExpanded ? 'Navigation' : 'Tap to navigate'}
          </Text>
        </View>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  mobileTabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    minHeight: 50,
    backgroundColor: RacingTheme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: RacingTheme.colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    zIndex: 999,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: -1},
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  mobileTabBarSignIn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  mobileTabBarSignInIcon: {
    fontSize: 18,
    marginRight: 6,
  },
  mobileTabBarSignInLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: RacingTheme.colors.primary,
  },
  mobileTabBarTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  mobileTabBarIcon: {
    fontSize: 18,
    color: RacingTheme.colors.primary,
    marginRight: 8,
  },
  mobileTabBarLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: RacingTheme.colors.text,
  },
  navigationContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: RacingTheme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1000,
  },
  navigationHeader: {
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: RacingTheme.colors.surfaceElevated,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  toggleIcon: {
    fontSize: 16,
    color: RacingTheme.colors.primary,
    marginRight: 8,
  },
  toggleText: {
    fontSize: 14,
    color: RacingTheme.colors.text,
    fontWeight: '500',
  },
  navigationItems: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  navigationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    backgroundColor: RacingTheme.colors.surfaceElevated,
  },
  activeNavigationItem: {
    backgroundColor: RacingTheme.colors.primary + '15', // Semi-transparent primary
    borderWidth: 1,
    borderColor: RacingTheme.colors.primary,
  },
  itemIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: RacingTheme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    position: 'relative',
  },
  itemIcon: {
    fontSize: 18,
  },
  activeIndicator: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: RacingTheme.colors.primary,
    borderWidth: 2,
    borderColor: RacingTheme.colors.surface,
  },
  itemContent: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: RacingTheme.colors.text,
  },
  activeItemLabel: {
    color: RacingTheme.colors.primary,
    fontWeight: '600',
  },
  currentScreenText: {
    fontSize: 12,
    color: RacingTheme.colors.primary,
    marginTop: 2,
  },
  navigationFooter: {
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: RacingTheme.colors.surfaceElevated,
  },
  footerText: {
    fontSize: 12,
    color: RacingTheme.colors.textSecondary,
  },
  // Web-specific styles
  webFooter: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: RacingTheme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: RacingTheme.colors.surfaceElevated,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  webNavigationItems: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  webNavigationItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 4,
    borderRadius: 8,
    position: 'relative',
  },
  webActiveNavigationItem: {
    backgroundColor: RacingTheme.colors.primary + '15',
  },
  webItemIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  webItemLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: RacingTheme.colors.text,
    textAlign: 'center',
  },
  webActiveItemLabel: {
    color: RacingTheme.colors.primary,
    fontWeight: '600',
  },
  webActiveIndicator: {
    position: 'absolute',
    top: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: RacingTheme.colors.primary,
  },
});

export default BottomNavigation;
