import { Mapa } from "../../../mapa/Mapa";

/**
 * Listener para un evento.
 * 
 * Esta funcion deberia ser generica para este evento y otros de pintado de distritos.
 * Tarea para otro dia.
 */
export function pintarDistritosIntendents(mapa: Mapa) {
    return evento => {
        const intendentes = evento.detail.data;
        for (let intendente of intendentes) {
            mapa.pintarDistritoPorID(intendente.distrito_id, intendente.color);
        }
    }
}