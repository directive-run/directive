'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  applyColorPreset,
  applyTypoPreset,
  applyFontSize,
  clearPresets,
  clearFontSize,
  findColorPreset,
  findTypoPreset,
  type ColorPreset,
  type TypoPreset,
} from '@/lib/brand-presets'
import {
  STORAGE_KEYS,
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
} from '@/lib/storage-keys'

export function useThemePresets() {
  const [colorId, setColorId] = useState<string>('default')
  const [typoId, setTypoId] = useState<number>(0)
  const [fontScale, setFontScale] = useState<number>(100)
  const [mounted, setMounted] = useState(false)
  const activeColorRef = useRef(colorId)

  useEffect(() => {
    setMounted(true)
    const savedColor = safeGetItem(STORAGE_KEYS.COLOR)
    const savedTypo = safeGetItem(STORAGE_KEYS.TYPO)
    const savedFontSize = safeGetItem(STORAGE_KEYS.FONT_SIZE)

    if (savedColor) {
      const preset = findColorPreset(savedColor)
      if (preset) {
        setColorId(savedColor)
        activeColorRef.current = savedColor
        applyColorPreset(preset)
      }
    }

    if (savedTypo) {
      const id = parseInt(savedTypo, 10)
      const preset = findTypoPreset(id)
      if (preset) {
        setTypoId(id)
        applyTypoPreset(preset)
      }
    }

    if (savedFontSize) {
      const scale = Number(savedFontSize)
      if (isFinite(scale)) {
        setFontScale(scale)
        applyFontSize(scale)
      }
    }
  }, [])

  const handleColorChange = useCallback((preset: ColorPreset) => {
    activeColorRef.current = preset.id
    setColorId(preset.id)
    applyColorPreset(preset)
    safeSetItem(STORAGE_KEYS.COLOR, preset.id)
  }, [])

  const handleTypoChange = useCallback((preset: TypoPreset) => {
    setTypoId(preset.id)
    applyTypoPreset(preset)
    safeSetItem(STORAGE_KEYS.TYPO, String(preset.id))
  }, [])

  const handleFontSizeChange = useCallback((newValue: number) => {
    const clamped = Math.max(80, Math.min(150, Math.round(newValue / 10) * 10))
    setFontScale(clamped)
    applyFontSize(clamped)
    if (clamped === 100) {
      clearFontSize()
      safeRemoveItem(STORAGE_KEYS.FONT_SIZE)
    } else {
      safeSetItem(STORAGE_KEYS.FONT_SIZE, String(clamped))
    }
  }, [])

  const handleReset = useCallback(() => {
    activeColorRef.current = 'default'
    clearPresets()
    setColorId('default')
    setTypoId(0)
    setFontScale(100)
    safeRemoveItem(STORAGE_KEYS.COLOR)
    safeRemoveItem(STORAGE_KEYS.TYPO)
    safeRemoveItem(STORAGE_KEYS.FONT_SIZE)
  }, [])

  const handleColorHover = useCallback((preset: ColorPreset) => {
    applyColorPreset(preset)
  }, [])

  const handleColorLeave = useCallback(() => {
    const current = findColorPreset(activeColorRef.current)
    if (current) {
      applyColorPreset(current)
    }
  }, [])

  return {
    colorId,
    typoId,
    fontScale,
    mounted,
    activeColorRef,
    handleColorChange,
    handleTypoChange,
    handleFontSizeChange,
    handleReset,
    handleColorHover,
    handleColorLeave,
  }
}
