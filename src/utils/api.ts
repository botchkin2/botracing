import AsyncStorage from '@react-native-async-storage/async-storage';
import {API_CONFIG} from '@/src/config/api';
import {ApiError, LapsResponse, TrackInfo, TracksResponse} from '@/src/types';
import axios, {AxiosError, AxiosInstance, AxiosResponse} from 'axios';
// SDK 55: the classic API lives under /legacy; the root import throws at runtime.
import * as FileSystem from 'expo-file-system/legacy';
import {Platform} from 'react-native';

// Laps uploaded from the PC, served by the lmuApi function.
// Local dev: set EXPO_PUBLIC_LMU_API_BASE (tools/lmu-sync/serve.mjs).
// On a deployed web page, use that site's own /api/lmu so PR preview channels
// hit their own Hosting rewrite instead of the live origin (CORS-blocked).
const PRODUCTION_API = 'https://botracing-61.web.app/api/lmu';
const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LMU_API_BASE) ||
  (Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  window.location?.protocol === 'https:'
    ? `${window.location.origin}/api/lmu`
    : PRODUCTION_API);

// Global request cache to ensure proper deduplication
// For React Native, we use a module-level variable since HMR works differently
const globalRequestCache = new Map<string, Promise<any>>();

// File system cache configuration
const CSV_CACHE_DIR = `${FileSystem.documentDirectory}csv-cache/`;
const CACHE_METADATA_KEY = 'csv_cache_metadata';

// Cache size limits (in bytes)
const MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB total cache size
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB per file
const CACHE_CLEANUP_THRESHOLD = 0.8; // Clean up when cache reaches 80% of max size

// Cache metadata structure
interface CacheMetadata {
  [lapId: string]: {
    filePath: string;
    size: number;
    lastAccessed: number;
    created: number;
    checksum?: string;
  };
}

// Ensure cache directory exists
const ensureCacheDirectory = async (): Promise<void> => {
  const dirInfo = await FileSystem.getInfoAsync(CSV_CACHE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CSV_CACHE_DIR, {intermediates: true});
  }
};

// Get cache metadata from AsyncStorage
const getCacheMetadata = async (): Promise<CacheMetadata> => {
  try {
    const metadata = await AsyncStorage.getItem(CACHE_METADATA_KEY);
    return metadata ? JSON.parse(metadata) : {};
  } catch (error) {
    console.error('Error reading cache metadata:', error);
    return {};
  }
};

// Save cache metadata to AsyncStorage
const saveCacheMetadata = async (metadata: CacheMetadata): Promise<void> => {
  try {
    await AsyncStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(metadata));
  } catch (error) {
    console.error('Error saving cache metadata:', error);
  }
};

// Generate cache file path for a lap ID
const getCacheFilePath = (lapId: string): string => {
  return `${CSV_CACHE_DIR}${lapId}.csv`;
};

// Calculate simple checksum for data validation
const calculateChecksum = (data: string): string => {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString();
};

// Simple compression for CSV data using delta encoding and sampling
const compressCsvData = (
  csvData: string,
): {compressed: string; metadata: any} => {
  const lines = csvData.split('\n');
  if (lines.length < 2) {
    return {compressed: csvData, metadata: {compressed: false}};
  }

  // Parse header to identify numeric columns
  const header = lines[0];
  const headers = header.split(',').map(h => h.trim());

  // Identify which columns are numeric (for delta encoding)
  const numericColumns = [
    'LapDistPct',
    'Lat',
    'Lon',
    'Brake',
    'Throttle',
    'RPM',
    'SteeringWheelAngle',
    'Speed',
    'Gear',
  ];
  const numericIndices: number[] = [];

  numericColumns.forEach(col => {
    const index = headers.indexOf(col);
    if (index !== -1) {
      numericIndices.push(index);
    }
  });

  // Apply delta encoding to numeric columns
  const compressedLines = [header]; // Keep header as-is
  let previousValues: (number | null)[] = new Array(headers.length).fill(null);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(',');
    const compressedValues: string[] = [];

    for (let j = 0; j < values.length; j++) {
      const value = values[j];
      const numValue = parseFloat(value);

      if (
        numericIndices.includes(j) &&
        !isNaN(numValue) &&
        previousValues[j] !== null
      ) {
        // Apply delta encoding for numeric values
        const delta = numValue - (previousValues[j] as number);
        compressedValues.push(delta.toString());
        previousValues[j] = numValue;
      } else {
        // Store absolute value for first occurrence or non-numeric
        compressedValues.push(value);
        if (numericIndices.includes(j) && !isNaN(numValue)) {
          previousValues[j] = numValue;
        }
      }
    }

    compressedLines.push(compressedValues.join(','));
  }

  const compressed = compressedLines.join('\n');

  return {
    compressed,
    metadata: {
      compressed: true,
      originalSize: csvData.length,
      compressedSize: compressed.length,
      compressionRatio: compressed.length / csvData.length,
      numericColumns: numericIndices,
    },
  };
};

// Decompress CSV data
const decompressCsvData = (compressedData: string, metadata: any): string => {
  if (!metadata.compressed) {
    return compressedData;
  }

  const lines = compressedData.split('\n');
  if (lines.length < 2) {
    return compressedData;
  }

  const header = lines[0];
  const headers = header.split(',').map(h => h.trim());
  const numericIndices = metadata.numericColumns || [];

  const decompressedLines = [header];
  let previousValues: (number | null)[] = new Array(headers.length).fill(null);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(',');
    const decompressedValues: string[] = [];

    for (let j = 0; j < values.length; j++) {
      const value = values[j];

      if (numericIndices.includes(j)) {
        const numValue = parseFloat(value);

        if (!isNaN(numValue) && previousValues[j] !== null) {
          // Apply reverse delta encoding
          const originalValue = (previousValues[j] as number) + numValue;
          decompressedValues.push(originalValue.toString());
          previousValues[j] = originalValue;
        } else {
          // First occurrence, store as absolute
          decompressedValues.push(value);
          if (!isNaN(numValue)) {
            previousValues[j] = numValue;
          }
        }
      } else {
        // Non-numeric column, store as-is
        decompressedValues.push(value);
      }
    }

    decompressedLines.push(decompressedValues.join(','));
  }

  return decompressedLines.join('\n');
};

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: API_CONFIG.TIMEOUT,
    });

    this.client.interceptors.response.use(
      response => response,
      async (error: AxiosError) => {
        const fullUrl = error.config?.baseURL + error.config?.url;
        console.error(`API error for ${fullUrl}:`, {
          message: error.message,
          status: error.response?.status,
          details: error.response?.data,
        });

        const apiError: ApiError = {
          message: error.message || 'An unexpected error occurred',
          code: error.code,
          details: error.response?.data,
          status: error.response?.status,
        };

        return Promise.reject(apiError);
      },
    );
  }

  // Deduplicate requests to prevent redundant API calls
  private async deduplicatedRequest<T>(
    method: string,
    url: string,
    config?: any,
  ): Promise<T> {
    const cacheKey = `${method}:${url}:${JSON.stringify(config || {})}`;

    // Check if we already have a pending request for this exact call
    if (globalRequestCache.has(cacheKey)) {
      return globalRequestCache.get(cacheKey)!;
    }

    // Create the request
    const requestPromise = this.client
      .request<AxiosResponse<T>>({
        method: method as any,
        url,
        ...config,
      })
      .then(result => {
        // Remove from cache after completion
        globalRequestCache.delete(cacheKey);
        return result.data;
      })
      .catch(error => {
        // Remove from cache on error
        globalRequestCache.delete(cacheKey);
        throw error;
      });

    // Cache the promise immediately
    globalRequestCache.set(cacheKey, requestPromise);

    return requestPromise;
  }

  // Get tracks (required for laps API: laps must be requested per track)
  async getTracks(): Promise<TracksResponse> {
    const raw = await this.deduplicatedRequest<TracksResponse | TrackInfo[]>(
      'GET',
      '/tracks',
    );
    if (Array.isArray(raw)) {
      return {items: raw};
    }
    return raw;
  }

  // Get laps with filtering
  async getLaps(params?: {
    limit?: number;
    offset?: number;
    age?: number; // days
    drivers?: string; // Must be comma-separated string for API
    cars?: number[];
    tracks?: number[];
    sessionTypes?: number[];
    event?: string; // Event ID to filter by
    unclean?: boolean; // Include unclean laps
    minLapTime?: number;
    maxLapTime?: number;
    group?: 'driver' | 'driver-car' | 'none'; // API grouping option
  }): Promise<LapsResponse> {
    // Convert array parameters to comma-separated strings for GET requests
    const processedParams = {
      ...params,
      cars: params?.cars?.join(','),
      tracks: params?.tracks?.join(','),
      sessionTypes: params?.sessionTypes?.join(','),
      event: params?.event,
    };

    const queryParams = {
      limit: 100, // Default limit
      ...processedParams,
    };

    return this.deduplicatedRequest<LapsResponse>('GET', '/laps', {
      params: queryParams,
    });
  }

  // Generic GET method for future endpoints
  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    try {
      const response: AxiosResponse<T> = await this.client.get(endpoint, {
        params,
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Get CSV data (for telemetry) with device caching and memory optimization
  async getCsv(
    endpoint: string,
    options?: {
      useCache?: boolean;
      skipCache?: boolean;
      maxRetries?: number;
      timeout?: number;
    },
  ): Promise<string> {
    const {
      // No file system on web; the browser and React Query cache there.
      useCache = Platform.OS !== 'web',
      skipCache = false,
      maxRetries = 2,
      timeout = 60000, // 60 seconds for large files
    } = options || {};

    // Extract lap ID from endpoint (assuming format: /laps/{lapId}/csv)
    const lapIdMatch = endpoint.match(/\/laps\/([^\/]+)\/csv/);
    const lapId = lapIdMatch ? lapIdMatch[1] : null;

    // Try to load from cache first (if enabled and we have a lap ID)
    if (useCache && lapId && !skipCache) {
      try {
        const cachedData = await this.getCachedCsv(lapId);
        if (cachedData) {
          console.log(`Loaded CSV for lap ${lapId} from device cache`);
          return cachedData;
        }
      } catch (error) {
        console.warn('Failed to load from cache:', error);
        // Continue to fetch from API
      }
    }

    let lastError: any;

    // Retry logic with exponential backoff for large files
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `Fetching CSV for ${endpoint} (attempt ${attempt + 1}/${
            maxRetries + 1
          })`,
        );

        // Fetch from API with extended timeout for large files
        const csvData = await this.deduplicatedRequest<string>(
          'GET',
          endpoint,
          {
            responseType: 'text',
            headers: {
              Accept: 'text/csv',
            },
            timeout,
            // Add progress tracking for large downloads
            onDownloadProgress: progressEvent => {
              if (progressEvent.total && progressEvent.total > 1024 * 1024) {
                // > 1MB
                const percentCompleted = Math.round(
                  (progressEvent.loaded * 100) / progressEvent.total,
                );
                console.log(`CSV download progress: ${percentCompleted}%`);
              }
            },
          },
        );

        // Validate CSV data (basic check)
        if (!csvData || csvData.length === 0) {
          throw new Error('Received empty CSV data');
        }

        // Check for common error responses in CSV format
        if (
          csvData.includes('out of shared memory') ||
          csvData.includes('memory')
        ) {
          throw new Error('Server memory error - file may be too large');
        }

        // Cache the data if we have a lap ID and caching is enabled
        if (useCache && lapId && csvData) {
          try {
            await this.cacheCsvData(lapId, csvData);
            console.log(
              `Cached CSV for lap ${lapId} to device (${(
                csvData.length /
                1024 /
                1024
              ).toFixed(2)} MB)`,
            );
          } catch (error) {
            console.warn('Failed to cache CSV data:', error);
            // Don't fail the request if caching fails
          }
        }

        return csvData;
      } catch (error: any) {
        lastError = error;
        console.error(
          `CSV download attempt ${attempt + 1} failed:`,
          error.message,
        );

        // Check if it's a memory-related error
        if (
          error.message?.includes('out of shared memory') ||
          error.message?.includes('memory') ||
          error.response?.status === 500
        ) {
          // For memory errors, don't retry as it will likely fail again
          throw new Error(
            `Server memory error downloading CSV data: ${error.message}`,
          );
        }

        // For other errors, wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    throw (
      lastError || new Error('Failed to download CSV data after all retries')
    );
  }

  // Get cached CSV data from device storage with decompression
  private async getCachedCsv(lapId: string): Promise<string | null> {
    try {
      await ensureCacheDirectory();
      const metadata = await getCacheMetadata();
      const cacheEntry = metadata[lapId];

      if (!cacheEntry) {
        return null;
      }

      const filePath = getCacheFilePath(lapId);
      const fileInfo = await FileSystem.getInfoAsync(filePath);

      if (!fileInfo.exists) {
        // Clean up metadata if file doesn't exist
        delete metadata[lapId];
        await saveCacheMetadata(metadata);
        return null;
      }

      // Read compressed file content
      const cacheDataStr = await FileSystem.readAsStringAsync(filePath);
      const cacheData = JSON.parse(cacheDataStr);

      // Handle different cache versions
      let csvData: string;
      if (cacheData.version === '1.0' && cacheData.compression?.compressed) {
        // Decompress data
        csvData = decompressCsvData(cacheData.data, cacheData.compression);
      } else {
        // Legacy uncompressed format
        csvData = cacheData.data || cacheData;
      }

      // Validate data if we have a checksum
      const checksum = cacheEntry.compressed
        ? calculateChecksum(cacheData.data)
        : calculateChecksum(csvData);

      if (cacheEntry.checksum && checksum !== cacheEntry.checksum) {
        console.warn(`Checksum mismatch for cached CSV ${lapId}, discarding`);
        await this.deleteCachedCsv(lapId);
        return null;
      }

      // Update last accessed time
      cacheEntry.lastAccessed = Date.now();
      await saveCacheMetadata(metadata);

      return csvData;
    } catch (error) {
      console.error('Error reading cached CSV:', error);
      return null;
    }
  }

  // Cache CSV data to device storage with compression and size management
  private async cacheCsvData(lapId: string, csvData: string): Promise<void> {
    try {
      // Compress the data
      const {compressed, metadata: compressionMetadata} =
        compressCsvData(csvData);

      // Check compressed file size limit
      if (compressed.length > MAX_FILE_SIZE) {
        console.warn(
          `Compressed CSV file for lap ${lapId} is too large (${(
            compressed.length /
            1024 /
            1024
          ).toFixed(2)}MB), skipping cache`,
        );
        return;
      }

      await ensureCacheDirectory();

      // Check if we need to clean up cache before adding new file
      await this.ensureCacheSize(compressed.length);

      const filePath = getCacheFilePath(lapId);
      const checksum = calculateChecksum(compressed);

      // Store both compressed data and compression metadata
      const cacheData = JSON.stringify({
        data: compressed,
        compression: compressionMetadata,
        version: '1.0',
      });

      // Write compressed file
      await FileSystem.writeAsStringAsync(filePath, cacheData);

      // Update metadata
      const metadata = await getCacheMetadata();
      const fileInfo = await FileSystem.getInfoAsync(filePath);

      metadata[lapId] = {
        filePath,
        size: fileInfo.size || cacheData.length,
        originalSize: csvData.length,
        compressedSize: compressed.length,
        compressionRatio: compressionMetadata.compressionRatio || 1,
        lastAccessed: Date.now(),
        created: Date.now(),
        checksum,
        compressed: true,
      };

      await saveCacheMetadata(metadata);

      const savings = (
        ((csvData.length - compressed.length) / csvData.length) *
        100
      ).toFixed(1);
      console.log(
        `Compressed CSV cache: ${savings}% space saved (${(
          compressed.length / 1024
        ).toFixed(1)}KB)`,
      );
    } catch (error) {
      console.error('Error caching CSV data:', error);
      throw error;
    }
  }

  // Delete cached CSV data
  private async deleteCachedCsv(lapId: string): Promise<void> {
    try {
      const filePath = getCacheFilePath(lapId);
      await FileSystem.deleteAsync(filePath, {idempotent: true});

      const metadata = await getCacheMetadata();
      delete metadata[lapId];
      await saveCacheMetadata(metadata);
    } catch (error) {
      console.error('Error deleting cached CSV:', error);
    }
  }

  // Clear all cached CSV data
  async clearCsvCache(): Promise<void> {
    try {
      await ensureCacheDirectory();

      const metadata = await getCacheMetadata();
      const lapIds = Object.keys(metadata);

      // Delete all cache files
      await Promise.all(
        lapIds.map(async lapId => {
          const filePath = getCacheFilePath(lapId);
          await FileSystem.deleteAsync(filePath, {idempotent: true});
        }),
      );

      // Clear metadata
      await AsyncStorage.removeItem(CACHE_METADATA_KEY);
      console.log(`Cleared ${lapIds.length} cached CSV files`);
    } catch (error) {
      console.error('Error clearing CSV cache:', error);
    }
  }

  // Ensure cache size is within limits by cleaning up old files
  private async ensureCacheSize(newFileSize: number): Promise<void> {
    const stats = await this.getCacheStats();

    // Check if adding this file would exceed cache limits
    if (stats.totalSize + newFileSize > MAX_CACHE_SIZE) {
      console.log('Cache size limit reached, cleaning up old files...');
      await this.cleanupCache(MAX_CACHE_SIZE - newFileSize);
    } else if (stats.totalSize > MAX_CACHE_SIZE * CACHE_CLEANUP_THRESHOLD) {
      console.log(
        'Cache size approaching limit, performing maintenance cleanup...',
      );
      await this.cleanupCache(MAX_CACHE_SIZE * 0.7); // Keep 70% of max size
    }
  }

  // Clean up cache to reach target size
  private async cleanupCache(targetSize: number): Promise<void> {
    try {
      const metadata = await getCacheMetadata();
      const files = Object.entries(metadata)
        .map(([lapId, entry]) => ({
          lapId,
          ...entry,
        }))
        .sort((a, b) => a.lastAccessed - b.lastAccessed); // Oldest first

      let currentSize = files.reduce((sum, file) => sum + file.size, 0);
      let filesToDelete: string[] = [];

      // Delete oldest files until we're under the target size
      for (const file of files) {
        if (currentSize <= targetSize) {
          break;
        }

        filesToDelete.push(file.lapId);
        currentSize -= file.size;
      }

      // Delete the files
      await Promise.all(
        filesToDelete.map(async lapId => {
          await this.deleteCachedCsv(lapId);
        }),
      );

      console.log(
        `Cleaned up ${filesToDelete.length} cached CSV files, freed ${
          (filesToDelete.length > 0
            ? files.reduce((sum, f) => sum + f.size, 0) - currentSize
            : 0) /
          1024 /
          1024
        }MB`,
      );
    } catch (error) {
      console.error('Error during cache cleanup:', error);
    }
  }

  // Get cache statistics
  async getCacheStats(): Promise<{
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
  }> {
    try {
      const metadata = await getCacheMetadata();
      const files = Object.entries(metadata).map(([lapId, entry]) => ({
        lapId,
        size: entry.size,
        originalSize: entry.originalSize,
        compressionRatio: entry.compressionRatio,
        lastAccessed: entry.lastAccessed,
        created: entry.created,
        compressed: entry.compressed || false,
      }));

      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      const originalTotalSize = files.reduce(
        (sum, file) => sum + (file.originalSize || file.size),
        0,
      );
      const compressionSavings =
        originalTotalSize > 0
          ? ((originalTotalSize - totalSize) / originalTotalSize) * 100
          : 0;
      const usagePercent =
        MAX_CACHE_SIZE > 0 ? (totalSize / MAX_CACHE_SIZE) * 100 : 0;

      return {
        totalFiles: files.length,
        totalSize,
        originalTotalSize,
        maxSize: MAX_CACHE_SIZE,
        usagePercent,
        compressionSavings,
        files,
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return {
        totalFiles: 0,
        totalSize: 0,
        originalTotalSize: 0,
        maxSize: MAX_CACHE_SIZE,
        usagePercent: 0,
        compressionSavings: 0,
        files: [],
      };
    }
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient;
