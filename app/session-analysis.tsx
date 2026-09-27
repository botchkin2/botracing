import {
  BottomNavigation,
  ScreenContainer,
  SessionAnalysis,
} from '@/src/components';
import {RacingTheme} from '@/src/theme';
import {SessionData} from '@/src/types';
import {useLocalSearchParams, useRouter} from 'expo-router';
import React from 'react';
import {StyleSheet} from 'react-native';

const SessionAnalysisScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams();
  const raw = Array.isArray(params.sessionData)
    ? params.sessionData[0]
    : params.sessionData;
  let sessionData: SessionData | null = null;
  if (typeof raw === 'string') {
    try {
      sessionData = JSON.parse(raw);
    } catch {
      sessionData = null;
    }
  }

  const handleBackToLaps = () => {
    router.back();
  };

  const handleMultiLapComparison = (selectedLaps?: Set<string>) => {
    const selectedLapIds = selectedLaps ? Array.from(selectedLaps) : undefined;
    router.push({
      pathname: '/multi-lap-comparison',
      params: {
        sessionData: JSON.stringify(sessionData),
        selectedLapIds: selectedLapIds
          ? JSON.stringify(selectedLapIds)
          : undefined,
      },
    });
  };

  return (
    <ScreenContainer style={styles.container}>
      {sessionData ? (
        <SessionAnalysis
          sessionData={sessionData}
          onBack={handleBackToLaps}
          onMultiLapComparison={handleMultiLapComparison}
        />
      ) : null}
      <BottomNavigation currentScreen='index' />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RacingTheme.colors.background,
  },
});

export default SessionAnalysisScreen;
