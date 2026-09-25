import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { PendingSms } from '../types';

type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

type TransactionSmsNative = {
  getCaptureQueueCounts(): Promise<{ sms: number; notifications: number }>;
  getAppVersion(): Promise<string>;
  getPermissionStatus(): Promise<PermissionStatus>;
  getDatabaseKey(): Promise<string>;
  importInbox(sinceTimestamp: number): Promise<number>;
  getPendingMessages(limit: number): Promise<PendingSms[]>;
  acknowledgeMessages(ids: string[]): Promise<void>;
  clearPendingData(): Promise<void>;
  getNotificationAccessStatus(): Promise<PermissionStatus>;
  openNotificationAccessSettings(): Promise<void>;
  getPendingGpayNotifications(limit: number): Promise<{
    id: string;
    packageName: string;
    title: string;
    body: string;
    postedAt: number;
  }[]>;
  acknowledgeGpayNotifications(ids: string[]): Promise<void>;
  getNotificationPackages(): Promise<string[]>;
  getNotificationAppChoices(): Promise<Array<{ packageName: string; label: string }>>;
  setNotificationPackages(packages: string[]): Promise<void>;
  getReviewReminder(): Promise<{ enabled: boolean; hour: number; minute: number }>;
  configureReviewReminder(enabled: boolean, hour: number, minute: number): Promise<void>;
  snoozeReviewReminder(minutes: number): Promise<void>;
};

const nativeModule = NativeModules.TransactionSms as
  | TransactionSmsNative
  | undefined;

export const TransactionSms = {
  available: Platform.OS === 'android' && nativeModule != null,

  getCaptureQueueCounts: () => nativeModule?.getCaptureQueueCounts() ?? Promise.resolve({ sms: 0, notifications: 0 }),
  getAppVersion: () => nativeModule?.getAppVersion() ?? Promise.resolve('unknown'),

  async requestPermission(): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') {
      return 'unavailable';
    }
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    const read = result[PermissionsAndroid.PERMISSIONS.READ_SMS];
    const receive = result[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS];
    if (
      read === PermissionsAndroid.RESULTS.GRANTED &&
      receive === PermissionsAndroid.RESULTS.GRANTED
    ) {
      return 'granted';
    }
    if (
      read === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
      receive === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    ) {
      return 'blocked';
    }
    return 'denied';
  },

  getPermissionStatus: () =>
    nativeModule?.getPermissionStatus() ?? Promise.resolve('unavailable'),

  getDatabaseKey: () =>
    nativeModule?.getDatabaseKey() ?? Promise.resolve('local-development-key'),

  importInbox: (sinceTimestamp: number) => {
    if (!nativeModule) {
      return Promise.resolve(0);
    }
    return nativeModule.importInbox(sinceTimestamp);
  },

  getPendingMessages: (limit = 100) =>
    nativeModule?.getPendingMessages(limit) ?? Promise.resolve([]),

  acknowledgeMessages: (ids: string[]) =>
    nativeModule?.acknowledgeMessages(ids) ?? Promise.resolve(),

  clearPendingData: () =>
    nativeModule?.clearPendingData() ??
    Promise.reject(new Error('Local data reset requires the updated Android app')),

  getNotificationAccessStatus: () =>
    nativeModule?.getNotificationAccessStatus() ?? Promise.resolve('unavailable'),

  openNotificationAccessSettings: () =>
    nativeModule?.openNotificationAccessSettings() ?? Promise.resolve(),

  getPendingGpayNotifications: (limit = 100) =>
    nativeModule?.getPendingGpayNotifications(limit) ?? Promise.resolve([]),

  acknowledgeGpayNotifications: (ids: string[]) =>
    nativeModule?.acknowledgeGpayNotifications(ids) ?? Promise.resolve(),

  getNotificationPackages: () => nativeModule?.getNotificationPackages() ?? Promise.resolve([]),
  getNotificationAppChoices: () => nativeModule?.getNotificationAppChoices() ?? Promise.resolve([]),
  setNotificationPackages: (packages: string[]) =>
    nativeModule?.setNotificationPackages(packages) ?? Promise.resolve(),

  requestNotificationPermission: async () => {
    if (Platform.OS !== 'android' || Platform.Version < 33) return true;
    return (await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)) === PermissionsAndroid.RESULTS.GRANTED;
  },
  getReviewReminder: () => nativeModule?.getReviewReminder() ?? Promise.resolve({ enabled: false, hour: 22, minute: 0 }),
  configureReviewReminder: (enabled: boolean, hour: number, minute: number) =>
    nativeModule?.configureReviewReminder(enabled, hour, minute) ?? Promise.resolve(),
  snoozeReviewReminder: (minutes: number) => nativeModule?.snoozeReviewReminder(minutes) ?? Promise.resolve(),
};
