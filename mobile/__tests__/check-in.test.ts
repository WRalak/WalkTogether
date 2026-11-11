jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [null, jest.fn()] }));
import { parseCheckInQr } from '@/app/events/scan';

describe('check-in QR parsing', () => {
  it('accepts only WalkTogether check-in links', () => {
    const id = '0b6f2c7e-1a2b-4c3d-8e9f-0123456789ab';
    expect(parseCheckInQr(`walktogether://events/${id}/check-in?code=2911.abcDEF_123-xyz`)).toEqual({ id, code: '2911.abcDEF_123-xyz' });
    expect(parseCheckInQr('https://evil.example/events/x')).toBeNull();
    expect(parseCheckInQr(`walktogether://events/${id}/check-in?code=a&redirect=x`)).toBeNull();
  });
});
