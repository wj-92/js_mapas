import { Feature, Map, MapBrowserEvent, View, Overlay } from 'ol'
import { fromLonLat } from 'ol/proj';
import OSM from 'ol/source/OSM'
import FullScreenControl from 'ol/control/FullScreen'
import TileLayer from 'ol/layer/Tile'
import { seccionToNombre } from '../util/seccionToNombre';
import { distritoToNombre } from '../util/distritoToNombre';
import { Funcion } from '../util/Funcion';
import * as Estilos from './Estilos'
import VectorLayer from 'ol/layer/Vector';
import { FeatureLike } from 'ol/Feature';
import { DistritosPorIdSeccion } from '../data/DistritosPorSeccion'
import { Extent } from 'ol/extent';
import VectorSource from 'ol/source/Vector';
import { Nivel } from './Nivel'
import { Style, Icon } from 'ol/style';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import { resaltar } from './estilo/resaltar';
import { hexToColor } from './estilo/hexToColor';
import { EventoEnfocar } from './eventos/EventoEnfocar';
import { aTitulo } from '../util/aTitulo';
import Point from 'ol/geom/Point';
import { getPinPath } from '../util/getPinPath';
import * as Interacciones from 'ol/interaction';
import * as Control from 'ol/control';

const extentBuenosAires = [ ...fromLonLat([-64, -42]), ...fromLonLat([-56, -32]) ] as Extent

/**
 * Valor de la opcion "Todos" en el selector de seccion/distrito.
 * 
 * Esto no deberia ir aqui, pero aca se queda. Por ahora.
 */
const OPCION_TODOS = String(-1);

export class Mapa {

    private map: Map;

    // Capas del mapa
    private openStreetMap: TileLayer;
    private todosLosDistritos: VectorLayer;
    private secciones: VectorLayer;
    private distritosEnfocados: VectorLayer;
    private entornoBsAs: VectorLayer;
    private iconosEnMapa: VectorLayer;

    private elementoResaltado: FeatureLike = null;

    private _nivel: Nivel = Nivel.TODAS_LAS_SECCIONES;
    get nivel(): Nivel { return this._nivel }

    private callbackAlClickearCualquierDistrito: Funcion<number, void>;
    private callbackAlEnfocar: Funcion<EventoEnfocar, void>;

    private estilosPersonalizados: {
        distritos: {[id: number]: Style},
        secciones: {[id: number]: Style}
    } = { distritos: {}, secciones: {} }

    constructor(
        private contenedor: HTMLElement,
        private tagSelect: HTMLSelectElement,
        capas: VectorLayer[]
    ) {
        // Cargar mapa de OpenStreetMap
        this.openStreetMap = new TileLayer({
            source: new OSM({ attributions: [] })
        })

        // Cargar secciones, distritos y entorno
        const [distritos, secciones, entornoBsAs] = capas;
        this.todosLosDistritos = distritos;
        this.secciones = secciones;
        this.entornoBsAs = entornoBsAs;
        this.distritosEnfocados = new VectorLayer({ source: new VectorSource() });
        this.iconosEnMapa = new VectorLayer({ source: new VectorSource() });

        // Establecer visibilidad
        this.openStreetMap.setVisible(false)
        this.todosLosDistritos.setVisible(false)
        this.secciones.setVisible(true)
        this.entornoBsAs.setVisible(true)
        this.iconosEnMapa.setVisible(true)

        // Establecer estilos
        this.todosLosDistritos.setStyle(Estilos.POR_DEFECTO)
        this.secciones.setStyle(Estilos.POR_DEFECTO)
        this.distritosEnfocados.setStyle(Estilos.POR_DEFECTO)
        this.entornoBsAs.setStyle(Estilos.ENTORNO)

        // Mostrar mapa
        this.map = new Map({
            target: this.contenedor,
            layers: [
                this.openStreetMap,
                this.todosLosDistritos,
                this.distritosEnfocados,
                this.secciones,
                this.entornoBsAs,
                this.iconosEnMapa
            ],
            view: new View({
                center: fromLonLat([-60, -37.3]),
                zoom: 0,
                extent: extentBuenosAires
            }),
            controls: Control.defaults({
                attribution: false,
                zoom: false
            }).extend([
                new FullScreenControl()
            ]),
            interactions: Interacciones.defaults({
                dragPan: true,
                altShiftDragRotate: false,
                doubleClickZoom: false,
                mouseWheelZoom: true,
                pinchZoom: false,
                shiftDragZoom: false,
                keyboard: false
            })
        });

        this.establecerInteraccion(Interacciones.MouseWheelZoom, false)
        this.establecerInteraccion(Interacciones.DragPan, false)
        
        // Establecer listeners
        this.map.on('pointermove', (e) => this.alMoverMouse(e))
        this.map.on('click', (e) => this.alHacerClick(e))

        this.listarOpcionesEnSelect(
            this.secciones.getSource().getFeatures(),
            seccionToNombre
        )
    }

    alMoverMouse(evento: MapBrowserEvent) {
        this.resaltarZonaBajoMouse(evento)
    }

    private resaltarZonaBajoMouse(evento: MapBrowserEvent) {
        if (this.elementoResaltado !== null) {
            const estiloPersonalizado = this.getEstiloPersonalizado(this.elementoResaltado as Feature)
            if (estiloPersonalizado) {
                (this.elementoResaltado as Feature).setStyle(estiloPersonalizado)
            } else {
                (this.elementoResaltado as Feature).setStyle(undefined)
            }
            this.elementoResaltado = null;
        }

        this.map.forEachFeatureAtPixel(evento.pixel, feature => {
            //if agregado para evitar click sobre el entorno -- REEMPLAZAR cuando haya tiempo
            if (feature.get('id') != '99999' && feature.getGeometry().getType() != 'Point') {
                this.elementoResaltado = feature;

                const estilo: Style = this.tieneEstiloPersonalizado(this.elementoResaltado as Feature)
                    ? this.calcularEstiloResaltado(this.getEstiloPersonalizado(this.elementoResaltado as Feature))
                    : Estilos.RESALTADO;
    
                (this.elementoResaltado as Feature).setStyle(estilo)
                return true;
            }
        })
    }

    alHacerClick(evento: MapBrowserEvent) {
        this.map.forEachFeatureAtPixel(evento.pixel, seccionOdistrito => {
            // If agregado para ignorar clicks sobre el entorno -- REEMPLAZAR cuando haya tiempo
            if (seccionOdistrito.get('id') != 99999) {
                // Detectar si se hizo click en una seccion o en un distrito
                if (seccionOdistrito.get('nombreSeccion')) {
                    this.alClickearSeccion(seccionOdistrito as Feature)
                } else {
                    this.alClickearDistrito(seccionOdistrito as Feature)
                }
            }
        })
    }

    private alClickearSeccion(seccion: Feature) {
        this._nivel = Nivel.UNA_SECCION
        this.enfocarSeccion(seccion)
    }

    private enfocarFeature(feature: Feature) {
        this.map.getView().fit(feature.getGeometry().getExtent())
    }

    private alClickearDistrito(distrito: Feature) {
        this._nivel = Nivel.UN_DISTRITO
        this.ocultarDistritos()
        this.enfocarDistrito(distrito)
        if (this.callbackAlClickearCualquierDistrito) {
            this.callbackAlClickearCualquierDistrito(distrito.get('id'))
        }
    }

    /**
     * Muestra las calles del distrito enfocado unicamente
     */
    mostrarCalles() {
        this.openStreetMap.setVisible(true)

        const distritoEnfocado = this.distritosEnfocados.getSource().getFeatures()[0]

        const elResto = this.todosLosDistritos.getSource()
            .getFeatures()
            .filter(f => f.get('id') !== distritoEnfocado.get('id'))
        
        this.distritosEnfocados.getSource().clear()
        this.distritosEnfocados.getSource().addFeatures(elResto)
    }

    ocultarCalles() {
        this.openStreetMap.setVisible(false)
    }

    mostrarDistritos() {
        this.todosLosDistritos.setVisible(true)
    }

    ocultarDistritos() {
        this.todosLosDistritos.setVisible(false)
    }

    ocultarDistritosEnfocados() {
        this.distritosEnfocados.setVisible(false)
    }

    mostrarSecciones() {
        this.secciones.setVisible(true)
    }

    ocultarSecciones() {
        this.secciones.setVisible(false)
    }

    mostrarEntornoBsAs() {
        this.entornoBsAs.setVisible(true)
    }

    mostrarIconosEnMapa() {
        this.iconosEnMapa.setVisible(true)
    }

    ocultarIconosEnMapa() {
        this.iconosEnMapa.setVisible(false)
    }

    enfocarDistritos() {
        this._nivel = Nivel.TODOS_LOS_DISTRITOS
        this.llamarCallbackEnfocar(this._nivel, null)

        this.ocultarSecciones()
        this.ocultarDistritosEnfocados()
        this.mostrarDistritos()
        this.enfocarBuenosAires()

        this.listarOpcionesEnSelect(
            this.todosLosDistritos.getSource().getFeatures(),
            distritoToNombre
        )

        this.tagSelect.value = OPCION_TODOS
        this.establecerInteraccion(Interacciones.MouseWheelZoom, true)
        this.establecerInteraccion(Interacciones.DragPan, true)
    }

    enfocarSecciones() {
        this._nivel = Nivel.TODAS_LAS_SECCIONES
        this.llamarCallbackEnfocar(this._nivel, null)

        this.ocultarDistritos()
        this.ocultarDistritosEnfocados()
        this.mostrarSecciones()
        this.enfocarBuenosAires()

        this.listarOpcionesEnSelect(
            this.secciones.getSource().getFeatures(),
            seccionToNombre
        )

        this.tagSelect.value = OPCION_TODOS;
    }

    enfocarBuenosAires() {
        this.map.getView().fit(extentBuenosAires)
        this.establecerInteraccion(Interacciones.MouseWheelZoom, false)
        this.establecerInteraccion(Interacciones.DragPan, false)
    }

    enfocarSeccionPorId(id: number) {
        const seccion = this.secciones
            .getSource()
            .getFeatures()
            .find(s => s.get('id') === id)
        
        if (seccion) {
            this.enfocarSeccion(seccion)
        } else {
            throw new Error(`No hay seccion con id = ${id}`)
        }
    }

    enfocarDistritoPorId(id: number) {
        const distrito = this.todosLosDistritos
            .getSource()
            .getFeatures()
            .find(d => d.get('id') === id)
        
        if (distrito) {
            this.ocultarDistritos()
            this.enfocarDistrito(distrito)
            this.mostrarDistritoEnSelect(id)
            if (this.callbackAlClickearCualquierDistrito) {
                this.callbackAlClickearCualquierDistrito(id)
            }
        } else {
            throw new Error(`No hay distrito con id = ${id}`)
        }
    }

    enfocarFeatureEnNivel(id: number, nivel: Nivel) {
        switch (nivel) {
            case Nivel.UNA_SECCION:
                this.enfocarSeccionPorId(id)
                break
            case Nivel.UN_DISTRITO:
                this.enfocarDistritoPorId(id)
                break
            default:
                break;
        }
    }

    pintarDistritoPorID(id: number, relleno?: string, borde?: string) {
        const distrito = this.todosLosDistritos
            .getSource()
            .getFeatures()
            .find(d => d.get('id') === id)
    
        const estilo = {}

        if (relleno) {
            estilo['fill'] = new Fill({ color: hexToColor(relleno) })
        }

        if (borde) {
            estilo['stroke'] = new Stroke({ color: hexToColor(borde), width: 2 })
        }

        if (distrito) {
            distrito.setStyle(new Style(estilo))
            this.estilosPersonalizados.distritos[id] = new Style(estilo)
        } else {
            throw new Error(`No hay distrito con id = ${id}`)
        }
    }

    private enfocarDistrito(distrito: Feature) {
        this._nivel = Nivel.UN_DISTRITO
        this.llamarCallbackEnfocar(this._nivel, distrito)

        this.enfocarFeature(distrito)

        this.ocultarSecciones()
        this.distritosEnfocados.getSource().clear()
        this.distritosEnfocados.getSource().addFeatures([distrito])
        this.distritosEnfocados.setVisible(true)

        this.tagSelect.value = String(distrito.get('id'))
        this.establecerInteraccion(Interacciones.MouseWheelZoom, true)
        this.establecerInteraccion(Interacciones.DragPan, true)
    }

    private enfocarSeccion(seccion: Feature) {
        this._nivel = Nivel.UNA_SECCION
        this.llamarCallbackEnfocar(this._nivel, seccion)

        this.enfocarFeature(seccion)
        const seccionId: number = seccion.get('id');

        this.secciones.setVisible(false)
        this.todosLosDistritos.setVisible(false)

        // Mostrar (solo?) los distritos de la seccion
        const idDistritos: number[] = DistritosPorIdSeccion[seccionId]
        const distritosQueEnfocar = this.todosLosDistritos
            .getSource()
            .getFeatures()
            .filter(feature => idDistritos.includes(feature.get('id')))

        this.distritosEnfocados.getSource().clear()
        this.distritosEnfocados.getSource().addFeatures(distritosQueEnfocar)
        this.distritosEnfocados.setVisible(true)

        this.listarOpcionesEnSelect(
            distritosQueEnfocar,
            distritoToNombre
        )

        this.tagSelect.value = OPCION_TODOS;
        this.establecerInteraccion(Interacciones.MouseWheelZoom, true)
        this.establecerInteraccion(Interacciones.DragPan, true)
    }

    private listarOpcionesEnSelect(features: Feature[], extraerNombre: Funcion<Feature, string>) {
        const opciones = features
            .map(feature => ({ nombre: extraerNombre(feature), valor: feature.get('id') }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre))
            .map(data => this.crearOptionTag(data.nombre, data.valor))
        
        
        while (this.tagSelect.firstChild) {
            this.tagSelect.removeChild(this.tagSelect.firstChild)
        }
        for (let opcion of opciones) {
            this.tagSelect.appendChild(opcion)
        }
        this.tagSelect.prepend(this.crearOptionTag('Todo', -1))
    }

    private crearOptionTag(nombre: string, valor: number) {
        const opt = document.createElement('option')
        opt.value = String(valor),
        opt.appendChild(document.createTextNode(aTitulo(nombre)))
        return opt
    }

    private mostrarDistritoEnSelect(id: number) {
        this.listarOpcionesEnSelect(
            this.todosLosDistritos.getSource().getFeatures(),
            distritoToNombre
        )
        
        this.tagSelect.value = String(id)
    }

    alClickerUnDistrito(id: number, callback) {
        throw new Error(`Aun no esta implementado!`)
    }

    alClickearCualquierDistrito(callback: Funcion<number, void>) {
        this.callbackAlClickearCualquierDistrito = callback
    }

    alEnfocar(callback: Funcion<EventoEnfocar, void>) {
        this.callbackAlEnfocar = callback;
    }

    private llamarCallbackEnfocar(nivel: Nivel, feature: Feature) {
        if (this.callbackAlEnfocar) {
            this.callbackAlEnfocar(new EventoEnfocar(nivel, feature));
        }
    }

    private calcularEstiloResaltado(estiloBase: Style): Style {
        return resaltar(estiloBase)
    }

    private getEstiloPersonalizado(f: Feature): Style | undefined {
        const estilosPersonalizados = f.get('nombreSeccion')
                ? this.estilosPersonalizados.secciones
                : this.estilosPersonalizados.distritos;
        const id = f.get('id')
        if (id in estilosPersonalizados) {
            return estilosPersonalizados[id]
        }
    }

    private tieneEstiloPersonalizado(f: Feature): boolean {
        const estilos = f.get('nombreSeccion')
                ? this.estilosPersonalizados.secciones
                : this.estilosPersonalizados.distritos;
        
        return f.get('id') in estilos;
    }

    //INICIO DE MANEJO DE ICONOS - MODIFICAR
    public deleteIconFeatures() {
        if (!!this.iconosEnMapa && !!this.iconosEnMapa.getSource()) {
            const iconos = this.iconosEnMapa.getSource();
            iconos.getFeatures().forEach(function (feature) {
                if (feature.getGeometry().getType() === 'Point') {
                    iconos.removeFeature(feature);
                }
            });
        }
    }

    public mostrarPinesEntidadesJudiciales(nombre, entidad, lonLatAtArray) {
        if (typeof entidad !== 'string') {
            console.debug('addIconToFeature: tipo es distinto de string')
        }
        var iconoPath = "../../../" + getPinPath('TRIBUNALES', entidad);

        this.iconosEnMapa.getSource().addFeature(
            this.crearIconFeature(nombre, iconoPath, lonLatAtArray)
        );
        return true;
    }
    
    private crearIconFeature(entityName, Iconopath, latLonAsArray) {
        var iconFeature = new Feature({
            geometry: new Point(fromLonLat(latLonAsArray)),
            name: entityName ?? ''
        });
    
        try {
            iconFeature.setStyle(new Style({
                image: new Icon({
                    anchor: [0.5, 1],
                    src: Iconopath,
                    scale: 0.7
                })
            }));
        } catch (e) {
            console.error("Error crearIconFeature function: " + e);
        }
        return iconFeature;
    }
    
    establecerInteraccion(interaccion, habilitar = true) {
        this.map.getInteractions().forEach(function (e) {
            if (e instanceof interaccion) {
                e.setActive(habilitar);
            }
        });
    }
}
