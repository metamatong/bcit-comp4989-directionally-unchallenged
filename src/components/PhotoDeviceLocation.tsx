/** Required device-location copy for the photo-to-route request. */
export function PhotoDeviceRequirement() {
  return (
    <div className="device-location-option" role="note">
      <strong>GPS is required</strong>
      <p className="helper">
        When you tap Get Directions, your browser requests your location. GPS narrows the building;
        the photo identifies the floor and starting area. Raw coordinates stay in this tab. Only
        matching building IDs, accuracy and reading time are sent to the app.
      </p>
    </div>
  );
}
