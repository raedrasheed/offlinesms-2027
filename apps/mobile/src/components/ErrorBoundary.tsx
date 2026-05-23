import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

// Catches render/runtime errors in the screen tree and shows the message
// instead of a blank white screen, so failures are diagnosable on-device.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error?.message, error?.stack);
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={s.root}>
          <Text style={s.title}>Something broke on this screen</Text>
          <Text style={s.msg}>{this.state.error.message}</Text>
          <Text style={s.stack}>{this.state.error.stack}</Text>
          <Pressable style={s.btn} onPress={() => this.setState({ error: null })}>
            <Text style={s.btnText}>Try again</Text>
          </Pressable>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  root:    { flexGrow: 1, padding: 24, paddingTop: 80, backgroundColor: '#fff', gap: 12 },
  title:   { fontSize: 18, fontWeight: '800', color: '#0B1220' },
  msg:     { fontSize: 14, color: '#EF4444', fontWeight: '600' },
  stack:   { fontSize: 11, color: '#6B7488', fontFamily: 'monospace' },
  btn:     { marginTop: 16, padding: 14, backgroundColor: '#1F7BA8', borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
});
