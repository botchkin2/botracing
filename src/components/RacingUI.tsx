import {RacingTheme} from '@/src/theme';
import React from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

interface RacingCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  glow?: boolean;
}

export const RacingCard: React.FC<RacingCardProps> = ({
  children,
  style,
  glow = false,
}) => (
  <View style={[styles.card, glow && styles.cardGlow, style]}>{children}</View>
);

interface RacingButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
  disabled?: boolean;
}

export const RacingButton: React.FC<RacingButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  style,
  disabled = false,
}) => {
  const buttonStyle = [
    styles.button,
    styles[variant],
    disabled && styles.disabled,
    style,
  ];

  return (
    <TouchableOpacity style={buttonStyle} onPress={onPress} disabled={disabled}>
      <Text style={[styles.buttonText, styles[`${variant}Text`]]}>{title}</Text>
    </TouchableOpacity>
  );
};

interface StatusBadgeProps {
  status: 'clean' | 'offtrack' | 'pit' | 'incomplete' | 'best' | string;
  style?: ViewStyle;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({status, style}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'clean':
        return {color: RacingTheme.colors.success, text: 'CLEAN'};
      case 'offtrack':
        return {color: RacingTheme.colors.error, text: 'OFF TRACK'};
      case 'pit':
        return {color: RacingTheme.colors.warning, text: 'PIT'};
      case 'incomplete':
        return {color: RacingTheme.colors.textTertiary, text: 'INCOMPLETE'};
      case 'best':
        return {color: RacingTheme.colors.primary, text: 'BEST LAP'};
      default:
        return {
          color: RacingTheme.colors.textSecondary,
          text: status.toUpperCase(),
        };
    }
  };

  const {color, text} = getStatusConfig();

  return (
    <View style={[styles.badge, {backgroundColor: color}, style]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
};

interface MetricCardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
  style?: ViewStyle;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  unit,
  trend,
  style,
}) => {
  const getTrendColor = () => {
    switch (trend) {
      case 'up':
        return RacingTheme.colors.success;
      case 'down':
        return RacingTheme.colors.error;
      default:
        return RacingTheme.colors.primary;
    }
  };

  return (
    <RacingCard style={[styles.metricCard, style] as any}>
      <Text style={styles.metricTitle}>{title}</Text>
      <Text style={styles.metricValue}>
        {value}
        {unit && <Text style={styles.metricUnit}> {unit}</Text>}
      </Text>
      {trend && (
        <View
          style={[styles.trendIndicator, {backgroundColor: getTrendColor()}]}
        />
      )}
    </RacingCard>
  );
};

interface LapTimeProps {
  time: number;
  isBest?: boolean;
  style?: ViewStyle;
  onPress?: () => void;
}

export const LapTime: React.FC<LapTimeProps> = ({
  time,
  isBest = false,
  style,
  onPress,
}) => {
  const formatTime = (seconds: number): string => {
    if (typeof seconds !== 'number' || isNaN(seconds)) {
      return '--:--.---';
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(3);
    return `${minutes}:${remainingSeconds.padStart(6, '0')}`;
  };

  const lapTimeComponent = (
    <Text style={[styles.lapTime, isBest && styles.bestLapTime, style]}>
      {formatTime(time)}
    </Text>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {lapTimeComponent}
      </TouchableOpacity>
    );
  }

  return lapTimeComponent;
};

interface TimeRangeSelectorProps {
  selectedRange: number; // in days
  onRangeChange: (days: number) => void;
  style?: ViewStyle;
}

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({
  selectedRange,
  onRangeChange,
  style,
}) => {
  const ranges = [
    {label: '24H', days: 1},
    {label: '3D', days: 3},
    {label: '7D', days: 7},
  ];

  return (
    <View style={[styles.timeRangeContainer, style]}>
      {ranges.map(range => (
        <TouchableOpacity
          key={range.days}
          style={[
            styles.timeRangeButton,
            selectedRange === range.days && styles.timeRangeButtonActive,
          ]}
          onPress={() => onRangeChange(range.days)}>
          <Text
            style={[
              styles.timeRangeText,
              selectedRange === range.days && styles.timeRangeTextActive,
            ]}>
            {range.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

interface DividerProps {
  style?: ViewStyle;
}

export const RacingDivider: React.FC<DividerProps> = ({style}) => (
  <View style={[styles.divider, style]} />
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    padding: RacingTheme.spacing.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
    ...RacingTheme.shadows.md,
  },
  cardGlow: {
    ...RacingTheme.shadows.glow,
  },
  button: {
    paddingVertical: RacingTheme.spacing.md,
    paddingHorizontal: RacingTheme.spacing.lg,
    borderRadius: RacingTheme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    ...RacingTheme.shadows.sm,
  },
  primary: {
    backgroundColor: RacingTheme.colors.primary,
  },
  secondary: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: RacingTheme.colors.primary,
  },
  danger: {
    backgroundColor: RacingTheme.colors.error,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: RacingTheme.typography.body,
    fontWeight: RacingTheme.typography.semibold,
    color: RacingTheme.colors.background,
  },
  primaryText: {
    color: RacingTheme.colors.background,
  },
  secondaryText: {
    color: RacingTheme.colors.primary,
  },
  dangerText: {
    color: RacingTheme.colors.text,
  },
  badge: {
    paddingHorizontal: RacingTheme.spacing.sm,
    paddingVertical: RacingTheme.spacing.xs,
    borderRadius: RacingTheme.borderRadius.sm,
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: RacingTheme.colors.background,
    fontSize: RacingTheme.typography.small,
    fontWeight: RacingTheme.typography.bold,
    fontFamily:
      Platform.OS === 'android' ? 'monospace' : RacingTheme.typography.mono,
    letterSpacing: 0.5,
  },
  metricCard: {
    alignItems: 'center',
    padding: RacingTheme.spacing.lg,
  },
  metricTitle: {
    fontSize: RacingTheme.typography.caption,
    color: RacingTheme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: RacingTheme.spacing.xs,
  },
  metricValue: {
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold,
    color: RacingTheme.colors.primary,
    fontFamily:
      Platform.OS === 'android' ? 'monospace' : RacingTheme.typography.mono,
  },
  metricUnit: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
  },
  trendIndicator: {
    position: 'absolute',
    top: RacingTheme.spacing.sm,
    right: RacingTheme.spacing.sm,
    width: 8,
    height: 8,
    borderRadius: RacingTheme.borderRadius.full,
  },
  lapTime: {
    fontSize: RacingTheme.typography.h3,
    fontWeight: RacingTheme.typography.bold,
    color: RacingTheme.colors.time,
    fontFamily:
      Platform.OS === 'android' ? 'monospace' : RacingTheme.typography.mono,
    letterSpacing: 0.5,
  },
  bestLapTime: {
    color: RacingTheme.colors.secondary,
    textShadowColor: RacingTheme.colors.secondary,
    textShadowOffset: {width: 0, height: 0},
    textShadowRadius: 4,
  },
  divider: {
    height: 1,
    backgroundColor: RacingTheme.colors.surfaceElevated,
    marginVertical: RacingTheme.spacing.md,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    backgroundColor: RacingTheme.colors.surface,
    borderRadius: RacingTheme.borderRadius.md,
    padding: RacingTheme.spacing.xs,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
    ...RacingTheme.shadows.sm,
  },
  timeRangeButton: {
    flex: 1,
    paddingVertical: RacingTheme.spacing.sm,
    paddingHorizontal: RacingTheme.spacing.md,
    borderRadius: RacingTheme.borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRangeButtonActive: {
    backgroundColor: RacingTheme.colors.primary,
    ...RacingTheme.shadows.sm,
  },
  timeRangeText: {
    fontSize: RacingTheme.typography.caption,
    fontWeight: RacingTheme.typography.medium,
    color: RacingTheme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  timeRangeTextActive: {
    color: RacingTheme.colors.background,
    fontWeight: RacingTheme.typography.bold,
  },
});
