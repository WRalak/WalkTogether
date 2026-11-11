import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';
import Constants from 'expo-constants';
import type { LatLng } from '@walktogether/gps';

export interface RouteMapProps {
  points: LatLng[];
  /** Follow the latest point (live recording). */
  follow?: boolean;
  height?: number;
  showEndpoints?: boolean;
}

/**
 * Map adapter. Tracking, storage and statistics never depend on the map SDK: this component only
 * renders provider-neutral coordinates. `google` uses react-native-maps (Google Maps on Android,
 * Apple Maps on iOS). A Mapbox adapter can implement the same props (see GPS_TRACKING_DESIGN.md).
 */
export function RouteMap({ points, follow, height = 260, showEndpoints = true }: RouteMapProps) {
  const ref = useRef<MapView>(null);
  const provider = (Constants.expoConfig?.extra?.mapProvider as string | undefined) === 'google' && Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;
  const coords = points.map((p) => ({ latitude: p.lat, longitude: p.lng }));
  const last = coords[coords.length - 1];

  useEffect(() => {
    if (!ref.current || !coords.length) return;
    if (follow && last) ref.current.animateCamera({ center: last, zoom: 17 }, { duration: 400 });
    else if (!follow && coords.length > 1) ref.current.fitToCoordinates(coords, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.length, follow]);

  return (
    <View style={{ height }} className="overflow-hidden rounded-3xl bg-primary-soft" accessibilityLabel="Route map">
      <MapView
        ref={ref}
        provider={provider}
        style={{ flex: 1 }}
        showsUserLocation={!!follow}
        toolbarEnabled={false}
        initialRegion={last ? { ...last, latitudeDelta: 0.01, longitudeDelta: 0.01 } : { latitude: -1.2921, longitude: 36.8219, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
      >
        {coords.length > 1 && <Polyline coordinates={coords} strokeColor="#127a50" strokeWidth={5} />}
        {showEndpoints && coords[0] && <Marker coordinate={coords[0]} pinColor="green" title="Start" />}
        {showEndpoints && !follow && last && coords.length > 1 && <Marker coordinate={last} pinColor="red" title="Finish" />}
      </MapView>
    </View>
  );
}
