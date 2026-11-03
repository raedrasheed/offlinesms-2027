import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
export function useClipVisibility() {
  const focused=useIsFocused();
  const [foreground,setForeground]=useState(AppState.currentState==='active');
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>setForeground(state==='active'));return()=>sub.remove();},[]);
  return focused && foreground;
}
