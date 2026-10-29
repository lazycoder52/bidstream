import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from './auth.store';
import { authApi } from '@/lib/api-client';

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it('updates state upon successful login', async () => {
    const mockUser = {
      id: '11111111-2222-3333-4444-555555555555',
      name: 'Test Buyer',
      email: 'buyer@example.com',
      role: 'BUYER' as const,
      createdAt: new Date().toISOString(),
    };

    vi.spyOn(authApi, 'login').mockResolvedValue({
      user: mockUser,
      accessToken: 'mock_jwt_token',
    });

    await useAuthStore.getState().login({
      email: 'buyer@example.com',
      password: 'Password123',
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.name).toBe('Test Buyer');
    expect(state.accessToken).toBe('mock_jwt_token');
  });

  it('clears state on logout', () => {
    useAuthStore.setState({
      user: {
        id: '1',
        name: 'Logged In',
        email: 'user@test.com',
        role: 'BUYER',
        createdAt: new Date().toISOString(),
      },
      accessToken: 'valid_token',
      isAuthenticated: true,
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
  });
});
