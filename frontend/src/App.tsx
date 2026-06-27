import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'
import { ProfileProvider } from '@/lib/profile'
import RequireAuth from '@/components/RequireAuth'
import RequireOnboarded from '@/components/RequireOnboarded'
import Login from '@/pages/Login'
import Onboarding from '@/pages/Onboarding'
import Dashboard from '@/pages/Dashboard'
import Candidates from '@/pages/Candidates'
import CandidateProfile from '@/pages/CandidateProfile'
import AddCandidate from '@/pages/AddCandidate'
import AcceptInvite from '@/pages/AcceptInvite'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ProfileProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <Onboarding />
                </RequireAuth>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <RequireOnboarded>
                    <Dashboard />
                  </RequireOnboarded>
                </RequireAuth>
              }
            />
            <Route
              path="/candidates"
              element={
                <RequireAuth>
                  <RequireOnboarded>
                    <Candidates />
                  </RequireOnboarded>
                </RequireAuth>
              }
            />
            <Route
              path="/candidates/new"
              element={
                <RequireAuth>
                  <RequireOnboarded>
                    <AddCandidate />
                  </RequireOnboarded>
                </RequireAuth>
              }
            />
            <Route
              path="/candidates/:id"
              element={
                <RequireAuth>
                  <RequireOnboarded>
                    <CandidateProfile />
                  </RequireOnboarded>
                </RequireAuth>
              }
            />
            <Route
              path="/accept-invite"
              element={
                <RequireAuth>
                  <AcceptInvite />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ProfileProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
