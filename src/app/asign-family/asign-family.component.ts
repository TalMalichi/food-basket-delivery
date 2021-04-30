import { Component, OnInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import { Location, GeocodeInformation, toLongLat, GetDistanceBetween } from '../shared/googleApiHelpers';
import { UrlBuilder, Filter, ServerFunction, StringColumn, DataAreaSettings, BoolColumn, SqlDatabase, AndFilter, FilterConsumerBridgeToSqlRequest, ValueListColumn, NumberColumn } from '@remult/core';

import { DeliveryStatus } from "../families/DeliveryStatus";
import { YesNo } from "../families/YesNo";

import { Helpers } from '../helpers/helpers';
import { DialogService, DestroyHelper, extractError } from '../select-popup/dialog';
import { UserFamiliesList } from '../my-families/user-families';

import { environment } from '../../environments/environment';
import { Route } from '@angular/router';

import { foreachSync, PromiseThrottle } from '../shared/utils';
import { ApplicationSettings, getSettings } from '../manage/ApplicationSettings';


import { Context } from '@remult/core';

import { BasketType } from '../families/BasketType';


import { SqlBuilder, wasChanged, PhoneColumn } from '../model-shared/types';
import { BusyService, SelectValueDialogComponent } from '@remult/angular';
import { Roles, AdminGuard, distCenterAdminGuard } from '../auth/roles';
import { GroupsStatsPerDistributionCenter, GroupsStats, GroupsStatsForAllDeliveryCenters } from '../manage/manage.component';
import { SendSmsAction } from './send-sms-action';

import { SelectCompanyComponent } from '../select-company/select-company.component';
import { SelectHelperComponent } from '../select-helper/select-helper.component';
import { FamilyDeliveries } from '../families/FamilyDeliveries';
import { SelectFamilyComponent } from '../select-family/select-family.component';
import { YesNoQuestionComponent } from '../select-popup/yes-no-question/yes-no-question.component';
import { CommonQuestionsComponent } from '../common-questions/common-questions.component';
import { DistributionCenters, DistributionCenterId, allCentersToken } from '../manage/distribution-centers';
import { CitiesStats, CitiesStatsPerDistCenter } from '../family-deliveries/family-deliveries-stats';
import { ActiveFamilyDeliveries } from '../families/FamilyDeliveries';
import { Families } from '../families/families';

import { HelperFamiliesComponent, DeliveryInList } from '../helper-families/helper-families.component';
import { familiesInRoute, optimizeRoute, routeStats, routeStrategyColumn } from './route-strategy';
import { moveDeliveriesHelper } from '../helper-families/move-deliveries-helper';
import { SelectListComponent } from '../select-list/select-list.component';
import { use } from '../translate';
import { MltFamiliesComponent } from '../mlt-families/mlt-families.component';
import { getLang } from '../sites/sites';
import { InputAreaComponent } from '../select-popup/input-area/input-area.component';



@Component({
    selector: 'app-asign-family',
    templateUrl: './asign-family.component.html',
    styleUrls: ['./asign-family.component.scss']
})

export class AsignFamilyComponent implements OnInit, OnDestroy {
    static route: Route = {
        path: 'assign-families', component: AsignFamilyComponent, canActivate: [distCenterAdminGuard]
    };
    @ViewChild("phoneInput", { static: false }) phoneInput: ElementRef;

    canSeeCenter() {
        return this.context.isAllowed(Roles.admin);
    }
    assignOnMap() {
        this.familyLists.forceShowMap = true;
        setTimeout(() => {
            this.helperFamilies.switchToMap();

            setTimeout(() => {
                this.familyLists.startAssignByMap(this.filterCity, this.filterGroup, this.dialog.distCenter.value, this.filterArea, this.basketType.id);
            }, 50);
        }, 50);

    }
    @ViewChild("helperFamilies", { static: false }) helperFamilies: HelperFamiliesComponent;

    hasPreferred() {
        return this.familyLists.helper.preferredDistributionAreaAddress.value || this.familyLists.helper.preferredFinishAddress.value;
    }
    preferredText() {
        if (this.hasPreferred()) {
            let r = this.familyLists.helper.preferredDistributionAreaAddress.value;
            if (this.familyLists.helper.preferredFinishAddress.value) {
                if (r.length > 0)
                    r += ", ";
                r += this.familyLists.helper.preferredFinishAddress.value;
            }
            return this.settings.lang.volunteerPreferences + ": " + r;
        }
    }
    async editHelper() {
        await this.familyLists.helper.displayEditDialog(this.dialog, this.busy);
        if (this.phone != this.familyLists.helper.phone.value)
            this.phone = this.familyLists.helper.phone.value;

    }
    async searchPhone() {
        this.clearHelperInfo(false);
        let cleanPhone = PhoneColumn.fixPhoneInput(this.phone, this.context);

        if (this.isValidPhone()) {
            this.phone = cleanPhone;
            let helper = await this.context.for(Helpers).findFirst(h => h.phone.isEqualTo(this.phone));
            if (helper) {

                this.initHelper(helper);
            } else {
                helper = this.context.for(Helpers).create();
                helper.phone.value = this.phone;
                this.initHelper(helper);

            }

        }
    }
    isValidPhone() {
        let cleanPhone = PhoneColumn.fixPhoneInput(this.phone, this.context);

        return (cleanPhone.length == 10 || cleanPhone.startsWith('+') && cleanPhone.length > 11);
    }
    async initHelper(helper: Helpers) {
        if (helper.theHelperIAmEscorting.value) {
            let other = await this.context.for(Helpers).findId(helper.theHelperIAmEscorting);
            if (await this.context.openDialog(YesNoQuestionComponent, q => q.args = {
                question: helper.name.value + ' ' + this.settings.lang.isDefinedAsEscortOf + ' ' + other.name.value + '. ' + this.settings.lang.displayFamiliesOf + ' ' + other.name.value + '?'
            }, q => q.yes)) {
                this.initHelper(other);
            }
            else
                this.clearHelperInfo();
            return;
        }
        this.helper = helper;
        this.initArea();
        this.phone = this.helper.phone.value;
        if (helper.isNew()) {
            await this.refreshList();
        }
        else {
            Helpers.addToRecent(helper);
            await this.refreshList();
            if (helper.leadHelper.value && this.familyLists.toDeliver.length == 0) {
                let from = await this.context.for(Helpers).lookupAsync(helper.leadHelper);
                new moveDeliveriesHelper(this.context, this.settings, this.dialog, () => this.familyLists.reload()).move(from, this.familyLists.helper, false
                    , this.settings.lang.for + " \"" + this.familyLists.helper.name.value + "\" " + this.settings.lang.isDefinedAsLeadVolunteerOf + " \"" + from.name.value + "\".")
            }
        }
    }

    clearHelperInfo(clearPhone = true) {
        this.helper = undefined;
        this.area = undefined;
        if (clearPhone)
            this.phone = '';
        this.familyLists.setRouteStats(undefined);
        this.preferRepeatFamilies = true;
        this.showRepeatFamilies = false;
        this.clearList();
        if (this.phoneInput)
            setTimeout(() => {
                this.phoneInput.nativeElement.focus();
            }, 200);
    }


    filterCity = '';
    filterArea = use.language.allRegions;
    allBaskets: BasketInfo = { id: 'undefined', name: this.settings.lang.allBaskets, unassignedFamilies: 0 };
    basketType: BasketInfo = this.allBaskets;
    selectCity() {
        this.refreshBaskets();
    }

    async assignmentCanceled() {
        this.lastRefreshRoute = this.lastRefreshRoute.then(
            async () => await this.refreshBaskets());
        this.doRefreshRoute();

    }
    moveBasktesFromOtherHelper() {
        this.context.openDialog(
            SelectHelperComponent, s => s.args = {
                filter: h => h.deliveriesInProgress.isGreaterOrEqualTo(1).and(h.id.isDifferentFrom(this.helper.id)),
                hideRecent: true,
                onSelect: async h => {
                    if (h) {
                        await this.verifyHelperExistance();
                        new moveDeliveriesHelper(this.context, this.settings, this.dialog, () => this.familyLists.reload()).move(h, this.familyLists.helper, false)
                    }
                }
            });
    }

    showHelperInput = true;
    specificToHelper(h: Helpers) {
        this.showHelperInput = false;
        this.phone = h.phone.value;
        this.initHelper(h);
    }
    lastRefreshRoute = Promise.resolve();
    useGoogleOptimization = true;
    doRefreshRoute() {

        this.lastRefreshRoute = this.lastRefreshRoute.then(
            async () => await this.busy.donotWait(

                async () =>
                    await this.familyLists.refreshRoute({ doNotUseGoogle: !this.useGoogleOptimization })


            )).catch(x => this.lastRefreshRoute = Promise.resolve());

    }
    smsSent() {
        this.clearHelperInfo();
    }



    async refreshBaskets() {
        await this.busy.donotWait(async () => {
            let groups: Promise<GroupsStats[]>;
            if (this.dialog.distCenter.value == allCentersToken) {
                groups = this.context.for(GroupsStatsForAllDeliveryCenters).find({ where: f => f.familiesCount.isGreaterThan(0), limit: 1000 });
            }
            else
                groups = this.context.for(GroupsStatsPerDistributionCenter).find({ where: f => f.familiesCount.isGreaterThan(0).and(f.distCenter.filter(this.dialog.distCenter.value)), limit: 1000 });
            groups.then(g => {
                this.groups = g;
                if (this.filterGroup != '' && !this.groups.find(x => x.name.value == this.filterGroup)) {

                    this.groups.push({ name: new StringColumn({ defaultValue: this.filterGroup }), familiesCount: new NumberColumn({ defaultValue: 0 }) });
                }
            });
            let r = (await AsignFamilyComponent.getBasketStatus({
                filterGroup: this.filterGroup,
                filterCity: this.filterCity,
                filterArea: this.filterArea,
                filterBasket: this.basketType.id,
                helperId: this.helper ? this.helper.id.value : '',
                distCenter: this.dialog.distCenter.value
            }));
            this.baskets = [this.allBaskets];
            this.baskets.push(...r.baskets);
            this.allBaskets.unassignedFamilies = 0;
            let found = false;
            if (this.basketType == this.allBaskets)
                found = true;
            for (const iterator of this.baskets) {
                this.allBaskets.unassignedFamilies += +iterator.unassignedFamilies;
                if (!found && this.basketType.id == iterator.id) {
                    this.basketType = iterator;
                    found = true;
                }
            }


            this.cities = r.cities;
            if (this.filterCity != '' && !this.cities.find(x => x.name == this.filterCity)) {

                this.cities.push({ name: this.filterCity, unassignedFamilies: 0 });
            }

            this.areas = r.areas;
            if (this.filterArea != getLang(this.context).allRegions && !this.areas.find(x => x.name == this.filterArea)) {

                this.areas.push({ name: this.filterArea, unassignedFamilies: 0 });
            }

            this.specialFamilies = +r.special;
            this.repeatFamilies = r.repeatFamilies;
            if (this.repeatFamilies.length > 0)
                this.showRepeatFamilies = true;

        });
    }

    baskets: BasketInfo[] = [];
    cities: CityInfo[] = [];
    areas: CityInfo[] = [];
    specialFamilies = 0;
    showRepeatFamilies = false;
    repeatFamilies: string[] = [];

    preferRepeatFamilies = true;
    async refreshList() {
        await Promise.all([
            this.familyLists.initForHelper(this.helper), this.refreshBaskets()]);

    }
    familyLists = new UserFamiliesList(this.context, this.settings);
    filterGroup = '';
    groups: GroupsStats[] = [];
    phone: string;
    helper: Helpers;

    area: DataAreaSettings = new DataAreaSettings({});
    changeShowCompany() {
        this.initArea();
        this.settings.save();
    }








    private initArea() {
        if (this.helper)
            this.area = new DataAreaSettings({
                columnSettings: () => {
                    let r = [];
                    if (this.settings.showCompanies.value)
                        r.push([this.helper.name,
                        {
                            column: this.helper.company,
                            click: () => this.findCompany(),
                            clickIcon: 'search'
                        }
                        ]);
                    else r.push([this.helper.name]);
                    if (this.settings.showHelperComment.value)
                        r.push(this.helper.eventComment);
                    if (this.settings.manageEscorts.value) {
                        r.push([this.helper.needEscort, this.helper.escort]);
                    }

                    return r;
                }
            });
    }

    clearList() {
        this.familyLists.clear();
    }
    findHelper() {
        this.context.openDialog(SelectHelperComponent, s => s.args = {
            onSelect: async h => {
                if (h) {
                    this.clearHelperInfo(false);
                    this.initHelper(await this.context.for(Helpers).findId(h.id));
                }
                else {
                    this.clearHelperInfo();
                }
            }
        })
    }



    destroyHelper = new DestroyHelper();
    ngOnDestroy(): void {
        this.destroyHelper.destroy();
    }
    constructor(public dialog: DialogService, private context: Context, public busy: BusyService, public settings: ApplicationSettings) {
        this.dialog.onDistCenterChange(() => this.refreshBaskets(), this.destroyHelper);

    }

    filterOptions: BoolColumn[] = [];
    async ngOnInit() {


        this.filterOptions.push(this.settings.showGroupsOnAssing, this.settings.showCityOnAssing, this.settings.showAreaOnAssing, this.settings.showBasketOnAssing, this.settings.showNumOfBoxesOnAssing);
        this.initArea();
        this.familyLists.userClickedOnFamilyOnMap =
            async families => {
                if (families.length == 1)
                    await this.assignFamilyBasedOnIdFromMap(families[0]);
                else if (families.length > 1) {
                    this.dialog.YesNoQuestion(this.settings.lang.atThisLocationThereAre + " " + families.length + this.settings.lang.deliveriesAssignAllOfThem, async () => {
                        await this.busy.doWhileShowingBusy(async () => {
                            for (const iterator of families) {
                                await this.assignFamilyBasedOnIdFromMap(iterator);
                            }
                        });
                    });
                }
            };

        if (!environment.production && this.showHelperInput) {
            this.phone = '0507330590';
            await this.searchPhone();

        }
        setTimeout(() => {
            if (this.phoneInput)
                this.phoneInput.nativeElement.focus();
        }, 200);

    }
    numOfBaskets: number = 1;
    private async assignFamilyBasedOnIdFromMap(familyId: string) {
        await this.busy.donotWait(async () => {
            let f = await this.context.for(ActiveFamilyDeliveries).findId(familyId);
            if (f && f.deliverStatus.value == DeliveryStatus.ReadyForDelivery && f.courier.value == "") {
                this.performSpecificFamilyAssignment(f, 'assign based on map');
            }
        });
    }

    add(what: number) {
        this.numOfBaskets += what;
        if (this.numOfBaskets < 1)
            this.numOfBaskets = 1;

    }
    getBasketsToClick() {
        return this.basketType.unassignedFamilies;
    }
    assigning = false;
    async assignItem(allRepeat?: boolean) {
        this.assigning = true;
        let basket = this.basketType;
        if (this.allBaskets == basket)
            basket = undefined;
        await this.verifyHelperExistance();
        try {
            let x = await AsignFamilyComponent.AddBox({
                basketType: basket ? basket.id : undefined,
                helperId: this.helper.id.value,
                group: this.filterGroup,
                city: this.filterCity,
                area: this.filterArea,
                numOfBaskets: allRepeat ? this.repeatFamilies.length : this.numOfBaskets,
                preferRepeatFamilies: this.preferRepeatFamilies && this.repeatFamilies.length > 0,
                allRepeat: allRepeat,
                distCenter: this.dialog.distCenter.value
            });
            if (x.addedBoxes) {
                this.familyLists.initForFamilies(this.helper, x.families);

                let refreshBaskets = basket == undefined;
                if (x.familiesInSameAddress.length > 0) {
                    if (await this.dialog.YesNoPromise(this.settings.lang.thereAreAdditional + " " + x.familiesInSameAddress.length + " " + this.settings.lang.deliveriesAtSameAddress)) {
                        await this.busy.doWhileShowingBusy(async () => {
                            this.dialog.analytics('More families in same address');
                            for (const id of x.familiesInSameAddress) {
                                let f = await this.context.for(ActiveFamilyDeliveries).findFirst(f => f.id.isEqualTo(id).and(f.readyFilter()));
                                f.courier.value = this.helper.id.value;
                                await f.save();
                            }
                            await this.familyLists.initForHelper(this.helper)
                        });
                    }
                }
                if (!refreshBaskets) {
                    basket.unassignedFamilies -= x.addedBoxes;

                }
                else {
                    this.refreshBaskets();
                }



                this.dialog.analytics('Assign Family');
                if (this.baskets == undefined)
                    this.dialog.analytics('Assign any Family (no box)');
                if (this.filterGroup)
                    this.dialog.analytics('assign family-group');
                if (this.filterCity)
                    this.dialog.analytics('assign family-city');
                if (this.numOfBaskets > 1)
                    this.dialog.analytics('assign family boxes=' + this.numOfBaskets);
            }
            else {
                this.refreshList();
                this.dialog.Info(this.settings.lang.noMatchingDelivery);
            }
            this.assigning = false;
        }
        catch (err) {
            this.assigning = false;
            await this.dialog.exception(this.settings.lang.assignDeliveryMenu, err);
        }

    }

    @ServerFunction({ allowed: Roles.distCenterAdmin })
    static async getBasketStatus(info: GetBasketStatusActionInfo, context?: Context, db?: SqlDatabase): Promise<GetBasketStatusActionResponse> {

        let result: GetBasketStatusActionResponse = {
            baskets: [],
            cities: [],
            areas: [],
            special: 0,
            repeatFamilies: []
        };

        let countFamilies = (additionalWhere?: (f: ActiveFamilyDeliveries) => Filter) => {
            return context.for(ActiveFamilyDeliveries).count(f => {
                let where = f.readyFilter(info.filterCity, info.filterGroup, info.filterArea, info.filterBasket).and(f.filterDistCenterAndAllowed(info.distCenter));
                if (additionalWhere) {
                    where = where.and(additionalWhere(f));
                }

                return where;
            });
        };

        result.special = await countFamilies(f => f.special.isEqualTo(YesNo.Yes));


        let sql = new SqlBuilder();
        let f = context.for(ActiveFamilyDeliveries).create();
        let fd = context.for(FamilyDeliveries).create();
        if (info.helperId) {
            let r = await db.execute(sql.build('select ', f.id, ' from ', f, ' where ', f.active().and(f.filterDistCenterAndAllowed(info.distCenter)).and(f.readyFilter(info.filterCity, info.filterGroup, info.filterArea, info.filterBasket).and(f.special.isEqualTo(YesNo.No))), ' and ',
                filterRepeatFamilies(sql, f, fd, info.helperId), ' limit 30'));
            result.repeatFamilies = r.rows.map(x => x[r.getColumnKeyInResultForIndexInSelect(0)]);
        }



        if (info.distCenter == allCentersToken) {
            for await (let c of context.for(CitiesStats).iterate({
                orderBy: ff => [{ column: ff.city }],
            })) {
                var ci = {
                    name: c.city.value,
                    unassignedFamilies: c.deliveries.value
                };
                if (!info.filterGroup) {
                    result.cities.push(ci);
                }
                else {
                    ci.unassignedFamilies = await countFamilies(f => f.city.isEqualTo(c.city.value));
                    if (ci.unassignedFamilies > 0)
                        result.cities.push(ci);
                }
            }
        } else {
            for await (let c of context.for(CitiesStatsPerDistCenter).iterate({
                orderBy: ff => [{ column: ff.city }],
                where: ff => ff.distributionCenter.filter(info.distCenter)
            })) {
                var ci = {
                    name: c.city.value,
                    unassignedFamilies: c.families.value
                };
                if (!info.filterGroup) {
                    result.cities.push(ci);
                }
                else {
                    ci.unassignedFamilies = await countFamilies(f => f.city.isEqualTo(c.city.value));
                    if (ci.unassignedFamilies > 0)
                        result.cities.push(ci);
                }
            }
        }
        let groupBy = (await db.execute(sql.build(sql.query({
            select: () => [
                sql.columnWithAlias(f.area, 'area'),
                sql.columnWithAlias(sql.func('count ', '*'), 'c')
            ],
            from: f,
            where: () => [f.filterDistCenterAndAllowed(info.distCenter), f.readyFilter(info.filterCity, info.filterGroup, undefined, info.filterBasket)]
        }), ' group by ', f.area, ' order by ', f.area)));
        result.areas = groupBy.rows.map(x => {
            let r: CityInfo = {
                name: x['area'],
                unassignedFamilies: +x['c']
            }
            return r;
        });



        let baskets = await db.execute(sql.build(sql.query({
            select: () => [f.basketType,
            sql.build('count (', f.quantity, ') b'),
            ],
            from: f,
            where: () => [f.filterDistCenterAndAllowed(info.distCenter), f.readyFilter(info.filterCity, info.filterGroup, info.filterArea)]
        }), ' group by ', f.basketType));
        for (const r of baskets.rows) {
            let basketId = r[baskets.getColumnKeyInResultForIndexInSelect(0)];
            let b = await context.for(BasketType).lookupAsync(b => b.id.isEqualTo(basketId));
            result.baskets.push({
                id: basketId,
                name: b.name.value,
                unassignedFamilies: +r['b']
            });
        }

        result.baskets.sort((a, b) => b.unassignedFamilies - a.unassignedFamilies);


        return result;
    }
    @ServerFunction({ allowed: c => c.isSignedIn(), blockUser: false })
    static async RefreshRoute(helperId: string, args: refreshRouteArgs, context?: Context) {

        if (!context.isAllowed(Roles.distCenterAdmin)) {
            if (helperId != context.user.id) {
                throw "Not Allowed";
            }
        }
        if (!args)
            args = {};
        let existingFamilies = await context.for(ActiveFamilyDeliveries).find({
            where: f => f.courier.isEqualTo(helperId).and(
                f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery))
        });
        let h = await context.for(Helpers).findId(helperId);
        let strategy = new routeStrategyColumn();
        strategy.value = (await ApplicationSettings.getAsync(context)).routeStrategy.value;
        if (args.strategyId)
            strategy.rawValue = args.strategyId;
        if (!strategy.value)
            throw "Invalid Strategy";
        let r = await optimizeRoute(h, existingFamilies, context, !args.doNotUseGoogle, strategy.value, args.volunteerLocation);
        r.families = r.families.filter(f => f.checkAllowedForUser());
        r.families = await context.for(ActiveFamilyDeliveries).toPojoArray(r.families);
        return r;
    }
    findCompany() {
        this.context.openDialog(SelectCompanyComponent, s => s.argOnSelect = x => this.helper.company.value = x);
    }
    async assignClosestDeliveries() {

        let afdList = await (HelperFamiliesComponent.getDeliveriesByLocation(this.familyLists.helper.preferredDistributionAreaAddress.location(), false));

        await this.context.openDialog(SelectListComponent, x => {
            x.args = {
                title: use.language.closestDeliveries + ' (' + use.language.mergeFamilies + ')',
                multiSelect: true,
                onSelect: async (selectedItems) => {
                    if (selectedItems.length > 0)
                        this.busy.doWhileShowingBusy(async () => {
                            let ids: string[] = [];
                            for (const selectedItem of selectedItems) {
                                let d: DeliveryInList = selectedItem.item;
                                ids.push(...d.ids);
                            }
                            await MltFamiliesComponent.assignFamilyDeliveryToIndie(ids);

                            await this.familyLists.reload();
                            this.doRefreshRoute();
                        });
                },
                options: afdList
            }
        });


    }
    @ServerFunction({ allowed: Roles.distCenterAdmin })
    static async AddBox(info: AddBoxInfo, context?: Context, db?: SqlDatabase) {
        let result: AddBoxResponse = {
            addedBoxes: 0,
            families: [],
            basketInfo: undefined,
            routeStats: undefined,
            familiesInSameAddress: []
        }
        if (!info.helperId)
            throw 'invalid helper';
        let helper = await context.for(Helpers).findId(info.helperId);
        if (!helper)
            throw "helper does not exist";

        let existingFamilies = await context.for(ActiveFamilyDeliveries).find({
            where: f => f.courier.isEqualTo(info.helperId).and(
                f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery)),
            orderBy: f => [{ column: f.routeOrder, descending: true }]
        });


        let locationReferenceFamilies: Location[] = [];
        let bounds: { lng1?: number, lng2?: number, lat1?: number, lat2?: number };
        let boundsExtend = (l: Location) => {
            if (!bounds) {
                bounds = {
                    lng1: l.lng,
                    lng2: l.lng,
                    lat1: l.lat,
                    lat2: l.lat
                }
            }
            else {
                if (l.lng < bounds.lng1) {
                    bounds.lng1 = l.lng;
                }
                if (l.lng > bounds.lng2) {
                    bounds.lng2 = l.lng;
                }
                if (l.lat < bounds.lat1) {
                    bounds.lat1 = l.lat;
                }
                if (l.lat > bounds.lat2) {
                    bounds.lat2 = l.lat;
                }
            }
        };
        let boundsContains = (l: Location) => {
            return (l.lng >= bounds.lng1 && l.lng <= bounds.lng2 && l.lat >= bounds.lat1 && l.lat <= bounds.lat2);
        };
        {

            let refFam: ActiveFamilyDeliveries[] = [...existingFamilies];
            if (refFam.length == 0) {
                let from = new Date();
                from.setDate(from.getDate() - 1);
                refFam = await context.for(ActiveFamilyDeliveries).find({
                    where: f => f.courier.isEqualTo(info.helperId).and(f.deliverStatus.isAResultStatus()).and(f.deliveryStatusDate.isGreaterOrEqualTo(from)),
                    orderBy: f => [{ column: f.deliveryStatusDate, descending: true }],
                    limit: 1
                });
            }
            let m = new Map<string, boolean>();
            for (const f of refFam) {
                let x = JSON.stringify(f.getDrivingLocation());
                if (!m.get(x)) {
                    m.set(x, true);
                    locationReferenceFamilies.push(f.getDrivingLocation());
                    boundsExtend(f.getDrivingLocation());
                }
            }
        }
        function buildWhere(f: ActiveFamilyDeliveries) {
            let where = f.readyFilter(info.city, info.group, info.area).and(
                f.special.isDifferentFrom(YesNo.Yes).and(f.filterDistCenterAndAllowed(info.distCenter))
            );
            if (info.basketType != undefined)
                where = where.and(
                    f.basketType.isEqualTo(info.basketType));
            return where;
        }

        let getFamilies = async () => {
            if (locationReferenceFamilies.length > 0 && info.preferRepeatFamilies && !info.allRepeat) {
                info.preferRepeatFamilies = false;
            }
            let f = context.for(ActiveFamilyDeliveries).create();
            let sql = new SqlBuilder();
            sql.addEntity(f, 'Families');
            let r = (await db.execute(sql.query({
                select: () => [sql.build('distinct ', [f.addressLatitude, f.addressLongitude])],
                from: f,
                where: () => {
                    let where = buildWhere(f);
                    let res = [];
                    res.push(where);
                    if (info.preferRepeatFamilies)
                        res.push(filterRepeatFamilies(sql, f, context.for(FamilyDeliveries).create(), info.helperId));
                    return res;
                }
            })));

            return r.rows.map(x => {
                return {

                    lat: +x[r.getColumnKeyInResultForIndexInSelect(0)],
                    lng: +x[r.getColumnKeyInResultForIndexInSelect(1)]
                } as Location;

            }) as Location[];


        }

        let waitingFamilies = await getFamilies();
        let i = 0;
        let settings = await ApplicationSettings.getAsync(context);
        while (i < info.numOfBaskets) {
            if (info.preferRepeatFamilies && waitingFamilies.length == 0 && !info.allRepeat) {
                info.preferRepeatFamilies = false;
                waitingFamilies = await getFamilies();

            }
            if (waitingFamilies.length == 0)
                break;



            let addFamilyToResult = async (fqr: Location) => {
                waitingFamilies.splice(waitingFamilies.indexOf(fqr), 1);
                locationReferenceFamilies.push(fqr);
                boundsExtend(fqr);
                for (const family of await context.for(ActiveFamilyDeliveries).find({
                    where: f => buildWhere(f).and(f.addressLongitude.isEqualTo(fqr.lng).and(f.addressLatitude.isEqualTo(fqr.lat)))
                        .and(f.filterDistCenterAndAllowed(info.distCenter))
                })) {
                    if (i < info.numOfBaskets) {
                        family.courier.value = info.helperId;
                        family._disableMessageToUsers = true;
                        family.routeOrder.value = existingFamilies.length + 1;
                        await family.save();
                        result.addedBoxes++;
                        existingFamilies.push(family);

                        i++;


                    }
                    else {
                        if (family.addressOk.value) {
                            result.familiesInSameAddress.push(family.id.value);
                        }
                    }
                }

            }

            if (waitingFamilies.length > 0) {
                let preferArea = helper.preferredDistributionAreaAddress.ok();
                let preferEnd = helper.preferredFinishAddress.ok();
                if (locationReferenceFamilies.length == 0 || (settings.isSytemForMlt() && (preferArea || preferEnd))) {

                    let distCenter = settings.address.location();
                    let lastFamiliy = waitingFamilies[0];

                    if (preferArea || preferEnd) {
                        lastFamiliy = undefined;
                        var lastDist: number;
                        for (const f of waitingFamilies) {
                            if (preferArea) {
                                let dist = GetDistanceBetween(f, helper.preferredDistributionAreaAddress.location());
                                if (!lastFamiliy || dist < lastDist) {
                                    lastFamiliy = f;
                                    lastDist = dist;
                                }
                            }
                            if (preferEnd) {
                                let dist = GetDistanceBetween(f, helper.preferredFinishAddress.location());
                                if (!lastFamiliy || dist < lastDist) {
                                    lastFamiliy = f;
                                    lastDist = dist;
                                }
                            }
                        }

                    } else {
                        let lastDist = 0;
                        for (const f of waitingFamilies) {
                            let dist = GetDistanceBetween(f, distCenter);
                            if (dist > lastDist) {
                                lastFamiliy = f;
                                lastDist = dist;
                            }
                        }
                    }
                    await addFamilyToResult(lastFamiliy);
                }
                else {

                    let getDistance = (x: Location) => {
                        let inBounds = boundsContains(x);

                        let r = 1000000;
                        if (!x)
                            return r;
                        let start = locationReferenceFamilies.length - 1;
                        if (start < 25)
                            start = 0;
                        else start -= 25;
                        for (let index = start; index < locationReferenceFamilies.length; index++) {
                            const ef = locationReferenceFamilies[index];
                            let loc = ef;
                            if (loc) {
                                let dis = GetDistanceBetween(x, loc);
                                if (inBounds) {
                                    dis /= 3;
                                }
                                if (dis < r)
                                    r = dis;
                            }

                        }

                        return r;

                    }

                    let smallFamily = waitingFamilies[0];
                    let dist = getDistance({
                        lat: smallFamily.lat,
                        lng: smallFamily.lng
                    });
                    for (let i = 1; i < waitingFamilies.length; i++) {
                        let f = waitingFamilies[i];
                        let myDist = getDistance({ lng: f.lng, lat: f.lat });
                        if (myDist < dist) {
                            dist = myDist;
                            smallFamily = waitingFamilies[i]
                            if (myDist == 0) {
                                break;
                            }
                        }

                    }
                    await addFamilyToResult(smallFamily);



                }

            }

        }


        existingFamilies = existingFamilies.filter(f => f.checkAllowedForUser());
        existingFamilies.sort((a, b) => a.routeOrder.value - b.routeOrder.value);
        result.families = await context.for(ActiveFamilyDeliveries).toPojoArray(existingFamilies);

        result.familiesInSameAddress = result.familiesInSameAddress.filter((x, i) => !existingFamilies.find(f => f.id.value == x) && result.familiesInSameAddress.indexOf(x) == i);
        Families.SendMessageToBrowsers(settings.lang.deliveriesAssigned, context, '');
        return result;
    }


    addSpecial() {
        this.addFamily(f => f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery).and(
            f.courier.isEqualTo('').and(f.special.isEqualTo(YesNo.Yes))), 'special');
    }
    addFamily(filter: (f: ActiveFamilyDeliveries) => Filter, analyticsName: string, selectStreet?: boolean, allowShowAll?: boolean) {
        this.context.openDialog(SelectFamilyComponent, x => x.args = {
            where: f => {
                let where = filter(f);
                if (this.filterCity)
                    where = new AndFilter(f.city.isEqualTo(this.filterCity), where);
                if (this.filterArea != use.language.allRegions)
                    where = new AndFilter(f.area.isEqualTo(this.filterArea), where);
                return where;
            },
            allowShowAll,
            selectStreet,
            distCenter: this.dialog.distCenter.value,
            onSelect: async selectedDeliveries => {

                for (const f of selectedDeliveries) {

                    let ok = async () => {
                        await this.performSpecificFamilyAssignment(f, analyticsName);
                    };

                    if (f.courier.value) {
                        if (selectStreet)
                            return;
                        let c = await f.courier.getTheName();
                        this.dialog.YesNoQuestion(this.settings.lang.theFamily + ' ' +
                            f.name.value + this.settings.lang.isAlreadyAsignedTo + ' ' + c + ' ' + this.settings.lang.onStatus + ' ' +
                            f.deliverStatus.displayValue + '. ' + this.settings.lang.shouldAssignTo + ' ' + this.helper.name.value + '?', async () => {
                                await ok();
                            });

                    }
                    else
                        await ok();
                }


            }
        })
    }

    private async performSpecificFamilyAssignment(f: ActiveFamilyDeliveries, analyticsName: string) {
        await this.verifyHelperExistance();
        f.courier.value = this.helper.id.value;
        f.deliverStatus.value = DeliveryStatus.ReadyForDelivery;
        this.dialog.analytics(analyticsName);
        await f.save();
        this.familyLists.addFamily(f);
        setTimeout(() => {
            this.refreshBaskets();
        }, 300);
    }
    private async assignMultipleFamilies(ids: string[], quantity = 0) {
        await this.verifyHelperExistance();
        await AsignFamilyComponent.assignMultipleFamilies({
            helper: this.helper.id.value,
            ids,
            quantity
        });
        this.refreshList();
    }
    @ServerFunction({ allowed: Roles.distCenterAdmin })
    static async assignMultipleFamilies(args: {
        helper: string,
        ids: string[],
        quantity: number,
    }, context?: Context) {
        let familyDeliveries = await context.for(ActiveFamilyDeliveries).find({
            where: fd =>
                fd.id.isIn(...args.ids).and(fd.isAllowedForUser()).and(fd.readyFilter())
        });
        if (args.quantity > 0) {
            familyDeliveries.sort((a, b) => {
                if (a.floor.value == b.floor.value) {
                    return (+b.appartment.value - +a.appartment.value);
                }
                return +b.floor.value - +a.floor.value;
            });
        }
        let added = 0;
        for (const fd of familyDeliveries) {
            if (args.quantity) {
                added += fd.quantity.value;
                if (added > args.quantity)
                    break;
            }
            fd.courier.value = args.helper;
            await fd.save();
        }
    }
    showSave() {
        return this.helper && this.helper.wasChanged();
    }
    async saveHelper() {
        await this.verifyHelperExistance();
        this.clearHelperInfo();
    }
    async verifyHelperExistance() {

        if (this.showSave()) {
            try {
                await this.helper.save();
            } catch (err) {
                await this.dialog.exception(this.settings.lang.saveVolunteerInfo, err);
                throw err;

            }
        }
        Helpers.addToRecent(this.helper);
    }
    addRepeat() {
        this.addFamily(f => f.id.isIn(...this.repeatFamilies), 'repeat-families')
    }
    addSpecific() {
        this.addFamily(f => f.readyFilter(this.filterCity, this.filterGroup, this.filterArea, this.basketType.id), 'specific', false, true);
    }
    addStreet() {
        this.addFamily(f => f.readyFilter(this.filterCity, this.filterGroup, this.filterArea, this.basketType.id), 'street', true);
    }
    async addBuilding() {
        let rows = await AsignFamilyComponent.selectBuildings({
            filterCity: this.filterCity,
            filterArea: this.filterArea,
            filterGroup: this.filterGroup,
            basketTypeId: this.basketType.id,
            distCenter: this.dialog.distCenter.value
        });
        if (rows.length == 0) {
            this.dialog.Error(this.settings.lang.noDeliveriesLeft);
        }
        else {
            this.context.openDialog(SelectValueDialogComponent, x => x.args(
                {
                    values: rows.map(r => ({
                        caption: r.address + " - (" + r.quantity + ")",
                        item: r
                    }))
                    , onSelect: async r => {
                        let q = new NumberColumn(this.settings.lang.quantity);
                        q.value = r.item.quantity;
                        await this.context.openDialog(InputAreaComponent, x => x.args = {
                            settings: {
                                columnSettings: () => [q]
                            },
                            title: this.settings.lang.quantity + " " + this.settings.lang.for + " " + r.item.address,
                            cancel: () => { },
                            ok: async () => {
                                await this.assignMultipleFamilies(r.item.ids, q.value);
                            }
                        });


                    }
                    , title: this.settings.lang.assignBuildings

                }))
        }
    }
    @ServerFunction({ allowed: Roles.distCenterAdmin })
    static async selectBuildings(args: {
        filterCity: string,
        filterGroup: string,
        filterArea: string,
        basketTypeId: string,
        distCenter: string
    },
        context?: Context,
        db?: SqlDatabase
    ) {
        var sql = new SqlBuilder();
        var fd = context.for(ActiveFamilyDeliveries).create();
        let result = await db.execute(sql.query({
            from: fd,
            select: () => [sql.columnWithAlias(sql.max('address'), 'address'), sql.sumWithAlias(fd.quantity, "quantity"), sql.build("string_agg(", fd.id, "::text, ',') ids")],
            where: () => [fd.filterDistCenterAndAllowed(args.distCenter),
            fd.readyFilter(args.filterCity, args.filterGroup, args.filterArea, args.basketTypeId)],
            groupBy: () => [fd.addressLatitude, fd.addressLongitude],
            having: () => [sql.build("sum(quantity)", '> 4')]
        }));
        let r: {
            address: string,
            quantity: number,
            ids: string[]
        }[] = []
        r = result.rows.map(r => ({
            address: r.address,
            quantity: r.quantity,
            ids: r.ids.split(',')
        }));
        return r;
    }

}

export interface AddBoxInfo {
    basketType: string;
    group: string;
    helperId: string;
    city: string;
    area: string;
    numOfBaskets: number;
    preferRepeatFamilies: boolean;
    allRepeat: boolean;
    distCenter: string;

}
export interface AddBoxResponse {
    families: any[];
    basketInfo: GetBasketStatusActionResponse
    addedBoxes: number;
    routeStats: routeStats;
    familiesInSameAddress: string[];


}
interface familyQueryResult {
    addressLatitude: number;
    addressLongitude: number;
}



function getInfo(r: any) {
    let dist = 0;
    let duration = 0;
    r.routes[0].legs.forEach(e => {
        dist += e.distance.value;
        duration += e.duration.value;
    });
    return {
        dist, duration
    }
}

export interface GetBasketStatusActionInfo {
    filterGroup: string;
    filterCity: string;
    filterArea: string;
    filterBasket: string;
    helperId: string;
    distCenter: string;
}
export interface GetBasketStatusActionResponse {
    baskets: BasketInfo[];
    cities: CityInfo[];
    areas: CityInfo[];
    special: number;
    repeatFamilies: string[];
}
export interface BasketInfo {
    name: string;
    id: string;
    unassignedFamilies: number;

}
function filterRepeatFamilies(sql: SqlBuilder, f: ActiveFamilyDeliveries, fd: FamilyDeliveries, helperId: string) {
    return sql.build(f.family, ' in (select ', fd.family, ' from ', fd, ' where ', fd.courier.isEqualTo(helperId), ')');

}
export interface CityInfo {
    name: string;
    unassignedFamilies: number;
}



export interface refreshRouteArgs {
    doNotUseGoogle?: boolean,
    strategyId?: number,
    volunteerLocation?: Location
}
