import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from './App';

vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({ token: null }),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <p>{location.pathname + location.search + location.hash}</p>;
};

describe('ProtectedRoute', () => {
  it('redirects signed-out protected routes to the workspace login intent', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute><p>private</p></ProtectedRoute>} />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('/?intent=workspace#login')).toBeInTheDocument();
  });
});
