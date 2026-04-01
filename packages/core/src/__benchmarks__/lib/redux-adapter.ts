import { configureStore, createSlice } from "@reduxjs/toolkit";
import type { BenchAdapter } from "./types";

const counterSlice = createSlice({
  name: "counter",
  initialState: { count: 0 },
  reducers: {
    set: (state, action: { payload: number }) => {
      state.count = action.payload;
    },
  },
});

export const reduxAdapter: BenchAdapter = {
  name: "Redux Toolkit",

  createCounter() {
    return configureStore({
      reducer: counterSlice.reducer,
      middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
    });
  },

  read(store) {
    return (store as any).getState().count;
  },

  write(store, value) {
    (store as any).dispatch(counterSlice.actions.set(value));
  },

  createWithDerived() {
    // Redux has no built-in derived — use a selector
    const store = configureStore({
      reducer: counterSlice.reducer,
      middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
    });
    return { store, getDoubled: () => (store as any).getState().count * 2 };
  },

  readDerived(store) {
    return (store as any).getDoubled();
  },

  writeDerived(store, value) {
    (store as any).store.dispatch(counterSlice.actions.set(value));
  },
};
