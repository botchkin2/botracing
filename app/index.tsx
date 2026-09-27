import {BottomNavigation, LapList, ScreenContainer} from '@/src/components';
import {RacingTheme} from '@/src/theme';
import {SessionData} from '@/src/types';
import {useRouter} from 'expo-router';
import React from 'react';
import {StyleSheet} from 'react-native';

const AnalysisScreen: React.FC = () => {
  const router = useRouter();

  const handleSessionAnalysis = (data: SessionData) => {
    router.push({
      pathname: '/session-analysis',
      params: {sessionData: JSON.stringify(data)},
    });
  };

  return (
    <ScreenContainer style={styles.container}>
      <LapList onSessionAnalysis={handleSessionAnalysis} />
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

export default AnalysisScreen;
