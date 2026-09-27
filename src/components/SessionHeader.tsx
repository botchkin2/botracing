import {RacingButton} from '@/src/components';
import {RacingTheme} from '@/src/theme';
import {SessionData} from '@/src/types';
import React from 'react';
import {Platform, Text, View} from 'react-native';

interface SessionHeaderProps {
  sessionData: SessionData;
  onBack: () => void;
}

const getSessionTypeName = (type: number): string => {
  switch (type) {
    case 1:
      return 'Practice';
    case 2:
      return 'Qualifying';
    case 3:
      return 'Race';
    default:
      return 'Unknown';
  }
};

const SessionHeader: React.FC<SessionHeaderProps> = ({sessionData, onBack}) => {
  return (
    <>
      {/* Back Button */}
      <View style={styles.backButtonContainer}>
        <RacingButton
          title='⬅ BACK TO SESSIONS'
          onPress={onBack}
          style={styles.backButton}
        />
      </View>

      {/* Session Header (title hidden on web; shown in top header) */}
      <View style={styles.header}>
        {Platform.OS !== 'web' && (
          <Text style={styles.title}>SESSION ANALYSIS</Text>
        )}
        <View style={styles.sessionInfo}>
          <Text style={styles.sessionName}>
            {sessionData.car.name} • {sessionData.track.name}
          </Text>
          <Text style={styles.sessionDetails}>
            {getSessionTypeName(sessionData.sessionType)} •{' '}
            {new Date(sessionData.startTime).toLocaleDateString()}
          </Text>
        </View>
      </View>
    </>
  );
};

const styles = {
  backButtonContainer: {
    marginBottom: RacingTheme.spacing.lg,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  header: {
    marginBottom: RacingTheme.spacing.lg,
  },
  title: {
    fontSize: RacingTheme.typography.h2,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    letterSpacing: 2,
    marginBottom: RacingTheme.spacing.sm,
  },
  sessionInfo: {
    backgroundColor: RacingTheme.colors.surface,
    padding: RacingTheme.spacing.md,
    borderRadius: RacingTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: RacingTheme.colors.surfaceElevated,
  },
  sessionName: {
    fontSize: RacingTheme.typography.h4,
    fontWeight: RacingTheme.typography.bold as any,
    color: RacingTheme.colors.primary,
    marginBottom: RacingTheme.spacing.xs,
  },
  sessionDetails: {
    fontSize: RacingTheme.typography.body,
    color: RacingTheme.colors.textSecondary,
  },
};

export default SessionHeader;
