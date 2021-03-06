import {store} from '../store/store';
import * as Actions from '../store/constants'
import Mnemonic from '../util/Mnemonic'
import Hasher from '../util/Hasher'
import IdGenerator from '../util/IdGenerator'
import StorageService from '../services/StorageService';
import AES from 'aes-oop';
import Scatter from '../models/Scatter';
import PopupService from '../services/PopupService'
import {Popup} from '../models/popups/Popup'
import {localizedState} from "../localization/locales";
import LANG_KEYS from "../localization/keys";
import {ipcAsync, ipcFaF, ipcRenderer} from "../util/ElectronHelpers";


export default class PasswordService {

    static isValidPassword(password, confirmPassword = null){
        if(!password || password.length < 8) {
            PopupService.push(Popup.snackbar(localizedState(LANG_KEYS.SNACKBARS.AUTH.PasswordLength)));
            return false;
        }

        if(confirmPassword !== null && password !== confirmPassword) {
          PopupService.push(Popup.snackbar(localizedState(LANG_KEYS.SNACKBARS.AUTH.InvalidConfirmation)));
            return false;
        }

        return true;
    }

    static async seedPassword(password, setToState = true){
        return new Promise(async (resolve, reject) => {
            try {
                let seed, mnemonic;
                if(password.split(' ').length >= 12) {
                    seed = await Mnemonic.mnemonicToSeed(password);
                    mnemonic = password;
                } else {
                    const [m, s] = await Mnemonic.generateMnemonic(password);
                    seed = s;
                    mnemonic = m;
                }

                if(setToState) ipcFaF('seeding', seed);
                resolve([mnemonic, seed]);
            } catch(e){
                resolve([null, null]);
            }
        })
    }

    static async verifyPassword(password = null){
        return new Promise(async resolve => {

            const testPassword = async (setToState, seed, mnemonic = false) => {
	            try {
		            let scatter = StorageService.getScatter();
		            scatter = AES.decrypt(scatter, seed);
		            if(setToState) await store.commit(Actions.SET_SCATTER, scatter);

		            if(!scatter.hasOwnProperty('keychain')) return resolve(false);

		            scatter = Scatter.fromJson(scatter);
		            scatter.decrypt(seed);
		            if(setToState) await store.dispatch(Actions.SET_SCATTER, scatter);
		            resolve(mnemonic ? mnemonic : true);
	            } catch(e) {
		            resolve(false);
	            }
            }

            if(!password){
	            await testPassword(true, await ipcAsync('seed'));
            } else {
                const [mnemonic, seed] = await PasswordService.seedPassword(password, false);
	            await testPassword(false, seed, mnemonic);
            }

        })
    }

    static async changePassword(newPassword){
        return new Promise(async resolve => {

            const oldSeed = await ipcAsync('seed');

            // Setting a new salt every time the password is changed.
            await StorageService.setSalt(Hasher.unsaltedQuickHash(IdGenerator.text(32)));
	        const [newMnemonic, newSeed] = await this.seedPassword(newPassword, true);

            // Re-encrypting keypairs
            const scatter = store.state.scatter.clone();
            scatter.keychain.keypairs.map(keypair => {
                keypair.decrypt(oldSeed);
                keypair.encrypt(newSeed);
            });
            scatter.keychain.identities.map(id => {
                id.decrypt(oldSeed);
                id.encrypt(newSeed);
            });

            await store.dispatch(Actions.SET_SCATTER, scatter);
            await StorageService.swapHistory(store.state.history);
            await StorageService.setTranslation(store.getters.language);
            store.dispatch(Actions.LOAD_HISTORY);
            store.dispatch(Actions.LOAD_LANGUAGE);
            resolve(newMnemonic);

        })
    }

    static async setPIN(pin, verify = false){
        return new Promise(resolve => {
            const set = async () => {
                const scatter = store.state.scatter.clone();
                scatter.pin = pin ? Hasher.unsaltedQuickHash(pin) : null;
                resolve(await store.dispatch(Actions.SET_SCATTER, scatter));
            };

            if(verify) PopupService.push(Popup.verifyPassword(verified => {
                if(!verified) return resolve(null);
	            set();
            }));

            else set();
        })
    }

    static async verifyPIN(){
        if(!store.state.scatter.pin || !store.state.scatter.pin.length) return true;
        return new Promise(resolve => {
            PopupService.push(Popup.enterPIN(verified => {
                resolve(verified);
            }))
        })
    }

}
