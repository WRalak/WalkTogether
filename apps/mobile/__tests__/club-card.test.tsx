import { render, screen } from '@testing-library/react-native';
import { ClubCard } from '@/components/club-card';

jest.mock('expo-router', () => {
  const { Pressable } = jest.requireActual('react-native');
  return { Link: ({ children }: { children: React.ReactElement }) => children, Pressable };
});

describe('ClubCard', () => {
  it('renders club information accessibly', () => {
    render(
      <ClubCard
        club={{ id: '1', slug: 'nairobi-sunrise', name: 'Nairobi Sunrise Walkers', description: 'Morning walks', category: 'WALKING', visibility: 'PRIVATE', logoUrl: null, coverUrl: null, city: 'Nairobi', countryCode: 'KE', memberCount: 1 }}
      />,
    );
    expect(screen.getByText('Nairobi Sunrise Walkers')).toBeTruthy();
    expect(screen.getByText('Request to join')).toBeTruthy();
    expect(screen.getByLabelText('Nairobi Sunrise Walkers, 1 members')).toBeTruthy();
    expect(screen.getByText(/1 member$|1 member ·|Nairobi, KE · 1 member/)).toBeTruthy();
  });
});
