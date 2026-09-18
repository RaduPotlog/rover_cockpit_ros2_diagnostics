/*
 * This file is part of Cockpit ROS 2 Diagnostics.
 *
 * Cockpit ROS 2 Diagnostics is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit ROS 2 Diagnostics is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import { useEffect, useState } from "react";

import cockpit from "cockpit";

/** Whether the session has administrative access (sudo) in Cockpit. */
export const useAdminPermission = (): boolean => {
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        const permission = cockpit.permission({ admin: true });
        const update = () => setAllowed(!!permission.allowed);
        permission.addEventListener("changed", update);
        update();
        return () => {
            permission.removeEventListener("changed", update);
            permission.close();
        };
    }, []);

    return allowed;
};
