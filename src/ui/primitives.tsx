import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { colors, radii, shadows, spacing, typeScale } from './theme';

export function Surface({ children, tone = 'default', style }: {
  children: React.ReactNode;
  tone?: 'default' | 'soft' | 'hero';
  style?: object;
}) {
  return <View style={[styles.surface, tone === 'soft' && styles.soft, tone === 'hero' && styles.hero, style]}>{children}</View>;
}

export function ScreenHeader({ eyebrow, title, onProfile, onBack }: {
  eyebrow?: string;
  title: string;
  onProfile?: () => void;
  onBack?: () => void;
}) {
  return <View style={styles.header}>
    {onBack && <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back" style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Icon name="back" />
    </Pressable>}
    <View style={styles.headerCopy}>
      {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
      <Text style={styles.title}>{title}</Text>
    </View>
    {onProfile && <Pressable onPress={onProfile} accessibilityRole="button" accessibilityLabel="Open settings" style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}>
      <Text style={styles.avatarText}>E</Text>
    </Pressable>}
  </View>;
}

export function SectionHeader({ title, meta, icon }: { title: string; meta?: string; icon?: IconName }) {
  return <View style={styles.sectionHeader}>
    <View style={styles.sectionTitleWrap}>{icon && <Icon name={icon} size={18} />}<Text style={styles.sectionTitle}>{title}</Text></View>
    {!!meta && <Text style={styles.sectionMeta}>{meta}</Text>}
  </View>;
}

export function ProgressBar({ progress }: { progress: number }) {
  const width = `${Math.max(0, Math.min(1, progress)) * 100}%` as `${number}%`;
  return <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
    <View style={[styles.progressFill, { width }]} />
  </View>;
}

const styles = StyleSheet.create({
  surface: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.lineSoft, ...shadows.card },
  soft: { backgroundColor: colors.limeSoft, borderColor: '#E3EEC7', shadowOpacity: 0, elevation: 0 },
  hero: { backgroundColor: colors.primary, borderColor: colors.primary },
  header: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xl },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.action, fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: typeScale.display, lineHeight: 38, fontWeight: '800', letterSpacing: -0.7, marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.limeSoft, borderWidth: 1, borderColor: '#DCE9BB', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontSize: 16, fontWeight: '900' },
  iconButton: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  pressed: { opacity: 0.68, transform: [{ scale: 0.98 }] },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, marginTop: spacing.xxl, marginBottom: spacing.md },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  sectionTitle: { color: colors.ink, fontSize: typeScale.heading, lineHeight: 25, fontWeight: '800', letterSpacing: -0.2 },
  sectionMeta: { color: colors.muted, fontSize: typeScale.caption, fontWeight: '700' },
  progressTrack: { height: 8, borderRadius: radii.pill, backgroundColor: colors.lineSoft, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: radii.pill, backgroundColor: colors.action },
});
