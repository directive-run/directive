// @ts-nocheck
/**
 * Contact Form React Hooks
 *
 * Thin wrappers around useFact, useDerived, and useEvents
 * for the contact form system.
 */
import { useFact, useDerived, useEvents } from '@directive-run/react'
import { getContactFormSystem } from './config'

export function useContactField(key: 'name' | 'email' | 'subject' | 'message' | 'status' | 'errorMessage') {
  return useFact(getContactFormSystem(), key)
}

export function useContactDerived(key: 'nameError' | 'emailError' | 'subjectError' | 'messageError' | 'isValid' | 'canSubmit' | 'messageCharCount') {
  return useDerived(getContactFormSystem(), key)
}

export function useContactFormEvents() {
  return useEvents(getContactFormSystem())
}

export function useCanSubmit() {
  return useDerived(getContactFormSystem(), 'canSubmit')
}

export function useFormStatus() {
  return useFact(getContactFormSystem(), 'status')
}
