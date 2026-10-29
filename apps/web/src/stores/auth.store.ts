import { create } from 'zustand';
import { UserDto, LoginDto, RegisterDto } from '@bidstream/contracts';
import { authApi, configureApiAuth } from '@/lib/api-client';

interface AuthState {
  user: UserDto | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (dto: LoginDto) => Promise<void>;
  register: (dto: RegisterDto) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Configure API client auth integration
  configureApiAuth(
    () => get().accessToken,
    async () => {
      try {
        const res = await authApi.refresh();
        set({
          user: res.user,
          accessToken: res.accessToken,
          isAuthenticated: true,
        });
        return res.accessToken;
      } catch {
        set({ user: null, accessToken: null, isAuthenticated: false });
        return null;
      }
    },
  );

  return {
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,

    login: async (dto) => {
      set({ isLoading: true });
      try {
        const res = await authApi.login(dto);
        set({
          user: res.user,
          accessToken: res.accessToken,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (err) {
        set({ isLoading: false });
        throw err;
      }
    },

    register: async (dto) => {
      set({ isLoading: true });
      try {
        const res = await authApi.register(dto);
        set({
          user: res.user,
          accessToken: res.accessToken,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch (err) {
        set({ isLoading: false });
        throw err;
      }
    },

    logout: () => {
      set({ user: null, accessToken: null, isAuthenticated: false });
    },

    checkAuth: async () => {
      set({ isLoading: true });
      try {
        const res = await authApi.refresh();
        set({
          user: res.user,
          accessToken: res.accessToken,
          isAuthenticated: true,
          isLoading: false,
        });
      } catch {
        set({
          user: null,
          accessToken: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    },
  };
});
