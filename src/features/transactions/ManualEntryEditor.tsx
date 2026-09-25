import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createManualTransaction, deleteManualTransaction, updateManualTransaction } from '../../data/database';
import { normalizedVendorKey } from '../../data/reviewGroups';
import type { Account, Transaction } from '../../types';
import { formatLocalDateTime, parseLocalDateTime } from './manualInput';

export function ManualEntryEditor({ visible, transaction, accounts, categories, onClose, onSaved }: {
  visible: boolean; transaction: Transaction | null; accounts: Account[]; categories: string[];
  onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<'debit' | 'credit'>('debit');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('Other');
  const [dateText, setDateText] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) { initializedKey.current = null; return; }
    const key = transaction?.id ?? 'new';
    if (initializedKey.current === key) return;
    initializedKey.current = key;
    setKind(transaction?.kind === 'credit' ? 'credit' : 'debit');
    setAccountId(transaction && accounts.find(item => item.id === transaction.accountId)?.type === 'bank'
      ? transaction.accountId : null);
    setAmount(transaction ? String(Math.abs(transaction.amountMinor) / 100) : '');
    setMerchant(transaction?.merchant ?? '');
    setCategory(transaction?.category ?? 'Other');
    setDateText(formatLocalDateTime(transaction?.occurredAt ?? Date.now()));
    setReference(transaction?.referenceId ?? '');
    setError(null);
  // Refreshes should not erase edits while this sheet is open.
  }, [visible, transaction, accounts]);
  const save = async () => {
    const occurredAt = parseLocalDateTime(dateText);
    const amountMinor = Math.round(Number(amount.replace(/,/g, '')) * 100);
    if (occurredAt == null) { setError('Use DD/MM/YYYY HH:mm for the date and time'); return; }
    setBusy(true);
    setError(null);
    try {
      const input = { accountId, amountMinor, kind, merchant, category, occurredAt,
        referenceId: reference.trim() || null };
      if (transaction) await updateManualTransaction(transaction.id, input);
      else await createManualTransaction(input);
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the transaction');
    } finally { setBusy(false); }
  };
  const remove = () => {
    if (!transaction) return;
    Alert.alert('Delete manual transaction?', 'This will remove it from reports. Linked shared expenses must be removed first.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await deleteManualTransaction(transaction.id); await onSaved(); onClose(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this transaction'); }
        finally { setBusy(false); }
      } },
    ]);
  };
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <View style={[s.page, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 12 }]}>
      <View style={s.header}><View><Text style={s.eyebrow}>MANUAL ENTRY</Text>
        <Text style={s.title}>{transaction ? 'Edit transaction' : 'Add transaction'}</Text></View>
        <Pressable onPress={onClose} accessibilityRole="button" style={s.done}><Text style={s.doneText}>Close</Text></Pressable></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <Text style={s.label}>TYPE</Text><View style={s.row}>
          {(['debit', 'credit'] as const).map(value => <Pressable key={value} onPress={() => setKind(value)}
            accessibilityRole="radio" accessibilityState={{ checked: kind === value }}
            style={[s.chip, kind === value && s.selected]}><Text style={[s.chipText, kind === value && s.selectedText]}>
              {value === 'debit' ? 'Expense' : 'Money received'}</Text></Pressable>)}
        </View>
        <Text style={s.label}>AMOUNT (₹)</Text><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad"
          accessibilityLabel="Amount in rupees" placeholder="0.00" placeholderTextColor="#88978D" style={s.input} />
        <Text style={s.label}>VENDOR OR PERSON</Text><TextInput value={merchant} onChangeText={setMerchant}
          accessibilityLabel="Vendor or person" autoCapitalize="words" maxLength={80} placeholder="Name" placeholderTextColor="#88978D" style={s.input} />
        {transaction && merchant.trim() !== transaction.merchant && normalizedVendorKey(transaction.merchant) &&
          <Text style={s.note}>This name change also updates other transactions from the same vendor.</Text>}
        <Text style={s.label}>ACCOUNT</Text><View style={s.row}>
          <Pressable onPress={() => setAccountId(null)} accessibilityRole="radio" accessibilityState={{ checked: accountId == null }}
            style={[s.chip, accountId == null && s.selected]}><Text style={[s.chipText, accountId == null && s.selectedText]}>Cash · reports only</Text></Pressable>
          {accounts.filter(item => item.type === 'bank').map(item => <Pressable key={item.id} onPress={() => setAccountId(item.id)}
            accessibilityRole="radio" accessibilityState={{ checked: accountId === item.id }}
            style={[s.chip, accountId === item.id && s.selected]}><Text style={[s.chipText, accountId === item.id && s.selectedText]}>{item.name}</Text></Pressable>)}
        </View>
        <Text style={s.note}>Manual entries change reports, not bank-reported balances. Manual credits are not counted as monthly income until you choose them on Home.</Text>
        <Text style={s.label}>CATEGORY</Text><View style={s.row}>{categories.map(item =>
          <Pressable key={item} onPress={() => setCategory(item)} accessibilityRole="radio" accessibilityState={{ checked: category === item }}
            style={[s.chip, category === item && s.selected]}><Text style={[s.chipText, category === item && s.selectedText]}>{item}</Text></Pressable>)}</View>
        <Text style={s.label}>DATE AND TIME · DD/MM/YYYY HH:mm</Text><TextInput value={dateText} onChangeText={setDateText}
          accessibilityLabel="Transaction date and time" keyboardType="numbers-and-punctuation" style={s.input} />
        <View style={s.row}><Pressable onPress={() => setDateText(formatLocalDateTime(Date.now()))}
          accessibilityRole="button" style={s.chip}><Text style={s.chipText}>Now</Text></Pressable>
          <Pressable onPress={() => { const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            setDateText(formatLocalDateTime(yesterday.getTime())); }} accessibilityRole="button"
            style={s.chip}><Text style={s.chipText}>Yesterday</Text></Pressable></View>
        {accountId && <><Text style={s.label}>BANK REFERENCE · OPTIONAL</Text><TextInput value={reference} onChangeText={setReference}
          accessibilityLabel="Bank reference" maxLength={80} placeholder="Helps match a later SMS" placeholderTextColor="#88978D" style={s.input} /></>}
        {error && <Text style={s.error}>{error}</Text>}
        <Pressable onPress={save} disabled={busy} accessibilityRole="button" style={s.save}><Text style={s.saveText}>{busy ? 'Saving…' : 'Save transaction'}</Text></Pressable>
        {transaction && <Pressable onPress={remove} disabled={busy} accessibilityRole="button" style={s.delete}><Text style={s.error}>Delete manual transaction</Text></Pressable>}
      </ScrollView>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F4F5EF', paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  eyebrow: { color: '#6A746E', letterSpacing: 1.6, fontSize: 10, fontWeight: '800' },
  title: { color: '#14211B', fontSize: 28, fontWeight: '800', marginTop: 4 },
  done: { backgroundColor: '#183E32', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 15 },
  doneText: { color: '#FFF', fontWeight: '800' },
  content: { paddingBottom: 30 },
  label: { color: '#56655C', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginTop: 17, marginBottom: 7 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 12, borderWidth: 1, borderColor: '#DDE5DD', backgroundColor: '#FFF', paddingVertical: 11, paddingHorizontal: 13, minHeight: 44 },
  selected: { backgroundColor: '#183E32', borderColor: '#183E32' },
  chipText: { color: '#183E32', fontWeight: '700' }, selectedText: { color: '#FFF' },
  input: { backgroundColor: '#FFF', borderRadius: 13, color: '#14211B', padding: 13, minHeight: 48 },
  note: { color: '#6A746E', fontSize: 12, lineHeight: 18, marginTop: 10 },
  error: { color: '#C7473E', fontWeight: '700', marginTop: 12 },
  save: { backgroundColor: '#183E32', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 22, minHeight: 52 },
  saveText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  delete: { alignItems: 'center', padding: 12, marginTop: 8 },
});
