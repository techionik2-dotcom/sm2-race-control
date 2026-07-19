import { create } from 'zustand'

const initialUiState = {
  activeOverlay: null,
  isMobileNavOpen: false,
}

export const useUiStore = create((set) => ({
  ...initialUiState,
  setActiveOverlay: (activeOverlay) => set({ activeOverlay }),
  setMobileNavOpen: (isMobileNavOpen) => set({ isMobileNavOpen }),
  resetUiState: () => set(initialUiState),
}))
