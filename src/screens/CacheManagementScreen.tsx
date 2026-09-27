import {BottomNavigation, ScreenContainer} from '@src/components';
import {useCacheManagement} from '@src/hooks/useCacheManagement';
import {RacingTheme} from '@src/theme';
import {apiClient} from '@src/utils/api';
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface CacheStats {
  csvCache: {
    totalFiles: number;
    totalSize: number;
    originalTotalSize: number;
    maxSize: number;
    usagePercent: number;
    compressionSavings: number;
    files: {
      lapId: string;
      size: number;
      originalSize?: number;
      compressionRatio?: number;
      lastAccessed: number;
      created: number;
      compressed: boolean;
    }[];
  };
  reactQueryCache: {
    queries: number;
    estimatedSize: number;
  };
}

const CacheManagementScreen: React.FC = () => {
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const cacheManager = useCacheManagement();

  const loadCacheStats = async () => {
    try {
      setLoading(true);
      const stats = await cacheManager.getCombinedCacheStats();
      setCacheStats(stats);
    } catch (error) {
      console.error('Error loading cache stats:', error);
      Alert.alert('Error', 'Failed to load cache statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCacheStats();
  }, []);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number): string => {
    return (
      new Date(timestamp).toLocaleDateString() +
      ' ' +
      new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    );
  };

  const handleClearCsvCache = () => {
    Alert.alert(
      'Clear CSV Cache',
      'This will delete all cached telemetry data from your device. You can redownload it later, but it will use data and may be slower.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            try {
              await cacheManager.clearCsvCache();
              await loadCacheStats();
              Alert.alert('Success', 'CSV cache cleared successfully');
            } catch {
              Alert.alert('Error', 'Failed to clear CSV cache');
            }
          },
        },
      ],
    );
  };

  const handleClearAllCache = () => {
    Alert.alert(
      'Clear All Cache',
      'This will clear all cached data including user data, lap lists, and telemetry. You will need to log in again.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              await cacheManager.clearAllCache();
              await cacheManager.clearCsvCache();
              await loadCacheStats();
              Alert.alert('Success', 'All cache cleared successfully');
            } catch {
              Alert.alert('Error', 'Failed to clear all cache');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <ScreenContainer style={[styles.container, styles.centered]}>
        <ActivityIndicator size='large' color={RacingTheme.colors.primary} />
        <Text style={styles.loadingText}>Loading cache statistics...</Text>
      </ScreenContainer>
    );
  }

  if (!cacheStats) {
    return (
      <ScreenContainer style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Failed to load cache statistics</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadCacheStats}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </ScreenContainer>
    );
  }

  const {csvCache, reactQueryCache} = cacheStats;

  return (
    <ScreenContainer style={styles.container}>
      <ScrollView>
        {/* Page header (hidden on web; title is in top header) */}
        {Platform.OS !== 'web' && (
          <View style={styles.header}>
            <Text style={styles.title}>Cache Management</Text>
            <Text style={styles.subtitle}>
              Monitor and manage your app&apos;s cached data to optimize storage
              and performance
            </Text>
          </View>
        )}

        {/* CSV Cache Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Telemetry Data Cache</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{csvCache.totalFiles}</Text>
              <Text style={styles.statLabel}>Files</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {formatBytes(csvCache.totalSize)}
              </Text>
              <Text style={styles.statLabel}>Used Space</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {csvCache.usagePercent.toFixed(1)}%
              </Text>
              <Text style={styles.statLabel}>Capacity Used</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {csvCache.compressionSavings.toFixed(1)}%
              </Text>
              <Text style={styles.statLabel}>Space Saved</Text>
            </View>
          </View>

          <Text style={styles.capacityText}>
            {formatBytes(csvCache.totalSize)} of {formatBytes(csvCache.maxSize)}{' '}
            used
          </Text>

          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClearCsvCache}>
            <Text style={styles.clearButtonText}>Clear Telemetry Cache</Text>
          </TouchableOpacity>
        </View>

        {/* React Query Cache Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App Data Cache</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{reactQueryCache.queries}</Text>
              <Text style={styles.statLabel}>Cached Queries</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {formatBytes(reactQueryCache.estimatedSize)}
              </Text>
              <Text style={styles.statLabel}>Estimated Size</Text>
            </View>
          </View>
        </View>

        {/* Recent Files */}
        {csvCache.files.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Cached Files</Text>
            {csvCache.files
              .sort((a, b) => b.lastAccessed - a.lastAccessed)
              .slice(0, 10)
              .map(file => (
                <View key={file.lapId} style={styles.fileItem}>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName}>Lap {file.lapId}</Text>
                    <Text style={styles.fileDetails}>
                      {formatBytes(file.size)}
                      {file.compressionRatio &&
                        file.compressionRatio < 1 &&
                        ` (${(file.compressionRatio * 100).toFixed(
                          0,
                        )}% of original)`}
                    </Text>
                    <Text style={styles.fileDate}>
                      Last accessed: {formatDate(file.lastAccessed)}
                    </Text>
                  </View>
                  {file.compressed && (
                    <View style={styles.compressedBadge}>
                      <Text style={styles.compressedText}>COMPRESSED</Text>
                    </View>
                  )}
                </View>
              ))}
          </View>
        )}

        {/* Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cache Actions</Text>

          <TouchableOpacity
            style={styles.refreshButton}
            onPress={loadCacheStats}>
            <Text style={styles.refreshButtonText}>Refresh Statistics</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.clearButton, styles.dangerButton]}
            onPress={handleClearAllCache}>
            <Text style={styles.clearButtonText}>Clear All Cache</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <BottomNavigation currentScreen='cache' />
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: RacingTheme.colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 20,
    backgroundColor: RacingTheme.colors.surface,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: RacingTheme.colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: RacingTheme.colors.textSecondary,
    lineHeight: 20,
  },
  section: {
    backgroundColor: RacingTheme.colors.surface,
    margin: 10,
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: RacingTheme.colors.text,
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    marginBottom: 16,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: RacingTheme.colors.primary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center',
  },
  capacityText: {
    fontSize: 12,
    color: RacingTheme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 16,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: RacingTheme.colors.surfaceElevated,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    color: RacingTheme.colors.text,
    marginBottom: 4,
  },
  fileDetails: {
    fontSize: 12,
    color: RacingTheme.colors.textSecondary,
    marginBottom: 2,
  },
  fileDate: {
    fontSize: 11,
    color: RacingTheme.colors.textSecondary,
  },
  compressedBadge: {
    backgroundColor: RacingTheme.colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  compressedText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: 'white',
  },
  clearButton: {
    backgroundColor: RacingTheme.colors.primary,
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  clearButtonText: {
    color: 'white',
    fontWeight: '600',
  },
  dangerButton: {
    backgroundColor: '#dc3545',
  },
  refreshButton: {
    backgroundColor: RacingTheme.colors.surfaceElevated,
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 8,
  },
  refreshButtonText: {
    color: RacingTheme.colors.text,
    fontWeight: '600',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: RacingTheme.colors.textSecondary,
  },
  errorText: {
    fontSize: 16,
    color: RacingTheme.colors.error || '#dc3545',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: RacingTheme.colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
  },
  retryButtonText: {
    color: 'white',
    fontWeight: '600',
  },
});

export default CacheManagementScreen;
