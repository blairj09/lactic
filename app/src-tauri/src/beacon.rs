// The ride beacon: while a ride page is open on this Mac and an iPhone is paired, Lactic shows up
// as a tiny Bluetooth LE accessory the phone stays connected to. Every so often (and whenever the
// interval changes) it sends a one-byte nudge; iOS wakes Lactic on the phone for it, even locked,
// and the phone asks for the ride over the usual encrypted link and updates its Live Activity. iOS
// gives a locked app no other way to hear from a computer without a push server. The nudge
// carries nothing about the ride; the link does the talking.
//
// CoreBluetooth on the main queue, so every call goes through `run_on_main_thread`. macOS only;
// elsewhere the commands do nothing.

use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::phone::Phone;

/// The ride beacon's service and its one characteristic (notify). The iPhone side
/// (plugins/lactic-phone/ios/Sources/RideBeacon.swift) uses the same two.
pub const SERVICE: &str = "D44E2015-D4BF-414E-AB02-E1A4C6ECA1DF";
pub const NUDGE: &str = "A7AF9720-6D30-4445-8F6E-B895B2F87166";

/// Starts the beacon (a phone is paired) or stops it.
#[tauri::command]
pub async fn ride_beacon(app: AppHandle, phone: State<'_, Arc<Phone>>, on: bool) -> Result<(), String> {
    let on = on && phone.has_phone().await;
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(move || mac::set(on)).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, on);
    Ok(())
}

/// Nudges a connected phone: something on the ride changed.
#[tauri::command]
pub async fn ride_beacon_nudge(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(mac::nudge).map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

#[cfg(target_os = "macos")]
mod mac {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, MainThreadMarker, MainThreadOnly};
    use objc2_core_bluetooth::{
        CBAdvertisementDataLocalNameKey, CBAdvertisementDataServiceUUIDsKey, CBAttributePermissions, CBCharacteristic, CBCharacteristicProperties, CBManagerState, CBMutableCharacteristic, CBMutableService,
        CBPeripheralManager, CBPeripheralManagerDelegate, CBUUID,
    };
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSString};

    use super::{NUDGE, SERVICE};

    struct Beacon {
        manager: Retained<CBPeripheralManager>,
        _delegate: Retained<Delegate>,
        nudge: Retained<CBMutableCharacteristic>,
        count: u8,
    }

    thread_local! {
        static BEACON: RefCell<Option<Beacon>> = const { RefCell::new(None) };
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "LacticRideBeaconDelegate"]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl CBPeripheralManagerDelegate for Delegate {
            #[unsafe(method(peripheralManagerDidUpdateState:))]
            fn did_update_state(&self, manager: &CBPeripheralManager) {
                // Bluetooth on (again): publish the service and advertise it. Off clears both.
                if unsafe { manager.state() } == CBManagerState::PoweredOn {
                    BEACON.with(|b| {
                        if let Some(b) = b.borrow().as_ref() {
                            publish(manager, &b.nudge);
                        }
                    });
                }
            }
        }
    );

    impl Delegate {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(());
            unsafe { msg_send![super(this), init] }
        }
    }

    fn uuid(s: &str) -> Retained<CBUUID> {
        unsafe { CBUUID::UUIDWithString(&NSString::from_str(s)) }
    }

    fn publish(manager: &CBPeripheralManager, nudge: &CBMutableCharacteristic) {
        unsafe {
            let service = CBMutableService::initWithType_primary(CBMutableService::alloc(), &uuid(SERVICE), true);
            let chars: Retained<NSArray<CBCharacteristic>> = NSArray::from_slice(&[nudge as &CBCharacteristic]);
            service.setCharacteristics(Some(&chars));
            manager.removeAllServices();
            manager.addService(&service);
            let uuids: Retained<NSArray<CBUUID>> = NSArray::from_retained_slice(&[uuid(SERVICE)]);
            let name = NSString::from_str("Lactic");
            let keys: [&NSString; 2] = [CBAdvertisementDataServiceUUIDsKey, CBAdvertisementDataLocalNameKey];
            let values: [&AnyObject; 2] = [&uuids, &name];
            let ad = NSDictionary::from_slices(&keys, &values);
            manager.startAdvertising(Some(&ad));
        }
    }

    pub fn set(on: bool) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        BEACON.with(|b| {
            let mut b = b.borrow_mut();
            if !on {
                if let Some(old) = b.take() {
                    unsafe {
                        old.manager.stopAdvertising();
                        old.manager.removeAllServices();
                    }
                }
                return;
            }
            if b.is_some() {
                return;
            }
            let delegate = Delegate::new(mtm);
            let nudge = unsafe {
                CBMutableCharacteristic::initWithType_properties_value_permissions(CBMutableCharacteristic::alloc(), &uuid(NUDGE), CBCharacteristicProperties::Notify | CBCharacteristicProperties::Read, None, CBAttributePermissions::Readable)
            };
            // Events on the main queue; the state callback publishes once Bluetooth is on.
            let manager = unsafe { CBPeripheralManager::initWithDelegate_queue(CBPeripheralManager::alloc(), Some(ProtocolObject::from_ref(&*delegate)), None) };
            *b = Some(Beacon { manager, _delegate: delegate, nudge, count: 0 });
        });
    }

    pub fn nudge() {
        BEACON.with(|b| {
            if let Some(b) = b.borrow_mut().as_mut() {
                b.count = b.count.wrapping_add(1);
                let value = NSData::with_bytes(&[b.count]);
                // False when the queue is full: the next nudge carries on, nothing to resend.
                let _ = unsafe { b.manager.updateValue_forCharacteristic_onSubscribedCentrals(&value, &b.nudge, None) };
            }
        });
    }
}
