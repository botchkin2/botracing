import {
  BottomNavigation,
  MultiLapComparison,
  ScreenContainer,
} from '@/src/components';
import {RacingTheme} from '@/src/theme';
import {SessionData} from '@/src/types';
import {useLocalSearchParams, useRouter} from 'expo-router';
import React from 'react';
import {StyleSheet} from 'react-native';

const MultiLapComparisonScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams();
  const sessionData: SessionData = JSON.parse(params.sessionData as string);
  const selectedLapIds: string[] | undefined = params.selectedLapIds
    ? JSON.parse(params.selectedLapIds as string)
    : undefined;
  const selectedLapIdsSet = selectedLapIds
    ? new Set(selectedLapIds)
    : new Set<string>();

  const handleBackToSessionAnalysis = () => {
    router.back();
  };

  return (
    <ScreenContainer style={styles.container}>
      <MultiLapComparison
        sessionData={sessionData}
        onBack={handleBackToSessionAnalysis}
        selectedLapIds={selectedLapIdsSet}
      />
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

export default MultiLapComparisonScreen;
