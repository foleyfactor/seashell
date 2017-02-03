import { connect } from 'react-redux';
import { ComponentClass } from 'react';
import { globalState } from '../reducers/';
import {projectRef, fileRef} from '../types';
import {appStateActions} from '../reducers/appStateReducer';
import {settingsActions, settingsReducerState} from '../reducers/settingsReducer';

interface Func<T> {
    ([...args]: any): T;
}

function returnType<T>(func: Func<T>) {
    return null as T;
}

const mapStoreToProps = (state:globalState) => state;

const mapDispatchToProps = (dispatch:Function) => {
    return {
        dispatch: {
          settings: {
             updateSettings:(newSettings: settingsReducerState)=>dispatch({type: settingsActions.updateSettings, payload: newSettings})
          }
        }
    }
};

const actionsStoreType = returnType(mapDispatchToProps);
export type actionsInterface = typeof actionsStoreType & globalState;

export function map(Component:ComponentClass<any>){
    return connect(mapStoreToProps,mapDispatchToProps)(Component);
}
